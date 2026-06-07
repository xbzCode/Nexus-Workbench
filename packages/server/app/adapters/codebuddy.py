"""CodeBuddy Adapter — 基于 codebuddy CLI 无头模式

执行模式:
  单轮: codebuddy -p "prompt" --output-format stream-json -y
  多轮: codebuddy --resume {session_id} -p "next prompt" --output-format stream-json -y

输出格式 (stream-json):
  每行一个 JSON 对象:
  - type:system subtype:init → 含 session_id
  - type:assistant → 含 thinking/text/tool_use
  - type:system subtype:result → 执行完成

使用 subprocess.Popen + 独立线程读取 stdout，通过 asyncio.Queue 传递事件。
不使用 asyncio.create_subprocess_exec，避免 Windows + uvicorn 的 NotImplementedError
（uvicorn 默认使用 SelectorEventLoop，不支持子进程）。
每个 session 仅占 1 个后台线程读取 stdout，不使用 ThreadPoolExecutor，
不会导致线程池饥饿。
"""

import asyncio
import copy
import json
import logging
import os
import shutil
import subprocess
import threading
import uuid
from typing import AsyncIterator

from app.adapters.base import AgentHarnessAdapter
from app.adapters.events import (
    AdapterEvent, AgentThinkingEvent,
    ToolUseEvent, ProgressUpdateEvent, ExecutionCompletedEvent,
)
from app.config.settings import settings

logger = logging.getLogger(__name__)


def _render_template(template: str, input_data: dict, workspace: str) -> str:
    """渲染提示词模板，支持 {input.xxx} 点号访问 dict"""
    class DotDict(dict):
        def __getattr__(self, key):
            try:
                val = self[key]
                if isinstance(val, dict):
                    return DotDict(val)
                return val
            except KeyError:
                return ""

    fmt_vars = {
        "input": DotDict(input_data),
        "workspace": workspace,
    }
    for k, v in input_data.items():
        if isinstance(v, str):
            fmt_vars.setdefault(k, v)

    try:
        return template.format(**fmt_vars)
    except (KeyError, IndexError):
        return template


def _find_codebuddy() -> str | None:
    """查找 codebuddy 可执行文件，返回可直接被 subprocess.Popen 执行的路径"""
    cb_path = settings.CODEBUDDY_PATH
    if os.name == "nt":
        # Windows: 优先找 .cmd 文件（subprocess.Popen 不带 shell=True 时需要完整路径）
        cmd_path = shutil.which(cb_path + ".cmd")
        if cmd_path:
            return cmd_path
        exe_path = shutil.which(cb_path + ".exe")
        if exe_path:
            return exe_path
    # Unix 或 fallback
    if shutil.which(cb_path):
        return cb_path
    if cb_path != "codebuddy":
        if os.name == "nt":
            cmd_path = shutil.which("codebuddy.cmd")
            if cmd_path:
                return cmd_path
        if shutil.which("codebuddy"):
            return "codebuddy"
    return None


class CodeBuddyAdapter(AgentHarnessAdapter):
    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self._available: str | None = None

    def _ensure_available(self) -> str:
        """确保 codebuddy 可用，返回实际路径"""
        if self._available is None:
            self._available = _find_codebuddy()
        if not self._available:
            raise RuntimeError(
                f"CodeBuddy 命令不可用: '{settings.CODEBUDDY_PATH}' 不在 PATH 中。"
                f"请安装 codebuddy 或修改 .env 中的 CODEBUDDY_PATH"
            )
        return self._available

    def _launch_process(self, cmd: list[str], workspace: str, env: dict | None = None) -> subprocess.Popen:
        """启动子进程（同步，在线程中调用）"""
        logger.info(f"[Adapter] Launching: {' '.join(cmd[:3])}... cwd={workspace}")
        proc = subprocess.Popen(
            cmd,
            cwd=workspace,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            encoding="utf-8",
            errors="replace",
        )
        logger.info(f"[Adapter] Process started: pid={proc.pid}")
        return proc

    def _build_cmd(self, prompt: str, config: dict) -> list[str]:
        """构建命令列表"""
        cbc_path = self._ensure_available()
        cmd = [
            cbc_path, "-p", prompt,
            "--output-format", "stream-json",
            "-y",
        ]
        if config.get("system_prompt_append"):
            cmd.extend(["--append-system-prompt", config["system_prompt_append"]])
        if config.get("allowed_tools"):
            cmd.extend(["--allowedTools", config["allowed_tools"]])
        if config.get("disallowed_tools"):
            cmd.extend(["--disallowedTools", config["disallowed_tools"]])
        return cmd

    async def start_session(self, config: dict) -> str:
        """启动 CodeBuddy 会话"""
        session_id = str(uuid.uuid4())
        workspace = config.get("workspace", os.path.join(settings.WORKSPACE_DIR, session_id))
        os.makedirs(workspace, exist_ok=True)

        # 1. 如果节点有 agent/skill/plugin 文件，复制到 workspace/.codebuddy/
        node_files = config.get("node_files", [])
        if node_files:
            codebuddy_dir = os.path.join(workspace, ".codebuddy")
            for f in node_files:
                dest = os.path.join(codebuddy_dir, f["path"])
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as fh:
                    fh.write(f["content"])

        # 2. 构建提示词
        prompt_template = config.get("prompt_template", "{input}")
        input_data = config.get("input_data", {})
        prompt = _render_template(prompt_template, input_data, workspace)

        # 2.5 注入 Team 级领域知识（放在用户输入前面作为 system context）
        team_prompt = config.get("team_prompt")
        if team_prompt:
            prompt = f"{team_prompt}\n\n---\n\n# 用户任务 / User Task\n\n{prompt}"
            logger.info(f"[Adapter] Injected team_prompt ({len(team_prompt)} chars)")

        # 3. 构建命令
        cmd = self._build_cmd(prompt, config)

        # 4. 构建环境变量（继承当前进程 + 注入 SKILL_DIR）
        env = copy.copy(os.environ)
        skill_dir = config.get("skill_dir")
        if skill_dir:
            env["SKILL_DIR"] = skill_dir

        # 5. 在线程中启动子进程
        loop = asyncio.get_event_loop()
        process = await loop.run_in_executor(None, self._launch_process, cmd, workspace, env)

        # 6. 创建 asyncio.Queue
        event_queue: asyncio.Queue[str | None] = asyncio.Queue()

        # 7. 启动后台线程读取 stdout
        def _read_stdout(proc: subprocess.Popen, q: asyncio.Queue):
            try:
                for line in proc.stdout:
                    line_str = line.strip() if isinstance(line, str) else line.decode("utf-8", errors="replace").strip()
                    if line_str:
                        q.put_nowait(line_str)
            except Exception as e:
                logger.error(f"[Adapter] stdout read error: {e}")
            finally:
                q.put_nowait(None)

        reader_thread = threading.Thread(
            target=_read_stdout,
            args=(process, event_queue),
            daemon=True,
            name=f"cbc-stdout-{session_id[:8]}",
        )
        reader_thread.start()

        self.sessions[session_id] = {
            "process": process,
            "workspace": workspace,
            "codebuddy_session_id": None,
            "config": config,
            "event_queue": event_queue,
            "reader_thread": reader_thread,
            "stdin_closed": False,
            "_completed": False,
        }

        return session_id

    async def on_event(self, session_id: str) -> AsyncIterator[AdapterEvent]:
        """从 asyncio.Queue 读取事件，解析 stream-json

        支持审批后进程 resume：当 respond() 替换了 event_queue 时，
        本方法会自动切换到新 queue 继续读取。
        """
        session = self.sessions.get(session_id)
        if not session:
            return

        event_queue: asyncio.Queue[str | None] = session["event_queue"]
        process: subprocess.Popen = session["process"]
        stderr_lines: list[str] = []

        # 后台读取 stderr
        def _read_stderr(proc: subprocess.Popen, lines: list[str]):
            try:
                for line in proc.stderr:
                    lines.append(line.strip() if isinstance(line, str) else line.decode("utf-8", errors="replace").strip())
            except Exception:
                pass

        stderr_thread = threading.Thread(
            target=_read_stderr,
            args=(process, stderr_lines),
            daemon=True,
            name=f"cbc-stderr-{session_id[:8]}",
        )
        stderr_thread.start()

        try:
            while True:
                line_str = await event_queue.get()
                if line_str is None:
                    # stdout EOF — 检查是否因 resume 切换了 queue
                    current_queue = session.get("event_queue")
                    if current_queue is not event_queue:
                        event_queue = current_queue
                        logger.info(f"[Adapter] Switched to resumed queue for session={session_id[:8]}")
                        continue
                    break
                async for event in self._parse_line(line_str, session):
                    yield event
        except Exception as e:
            logger.error(f"[Adapter] event queue read error: {e}")

        # 等待进程退出
        final_process = session.get("process", process)
        try:
            final_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.warning(f"[Adapter] Process wait timed out, killing session={session_id[:8]}")
            try:
                final_process.kill()
            except Exception:
                pass

        stderr_thread.join(timeout=3)

        if stderr_lines:
            logger.warning(f"CodeBuddy stderr (session={session_id[:8]}): {stderr_lines[:5]}")

        # 无论退出码如何，都发出完成事件
        if final_process.returncode != 0:
            stderr_msg = "; ".join(stderr_lines[:3]) if stderr_lines else ""
            yield ExecutionCompletedEvent(output={
                "exit_code": final_process.returncode,
                "error": f"进程异常退出 code={final_process.returncode}: {stderr_msg}",
            })
        elif not session.get("_completed"):
            yield ExecutionCompletedEvent(output={
                "status": "completed",
                "exit_code": 0,
                "message": "进程正常退出",
            })

    async def _parse_line(self, line_str: str, session: dict) -> AsyncIterator[AdapterEvent]:
        """解析单行输出"""
        try:
            data = json.loads(line_str)
        except json.JSONDecodeError:
            yield AgentThinkingEvent(content=line_str)
            return

        async for event in self._parse_stream_json(data, session):
            yield event

    async def _parse_stream_json(self, data: dict, session: dict) -> AsyncIterator[AdapterEvent]:
        """解析单行 stream-json"""
        msg_type = data.get("type", "")

        if msg_type == "system":
            subtype = data.get("subtype", "")

            if subtype == "init":
                cb_session = data.get("session_id")
                if cb_session:
                    session["codebuddy_session_id"] = cb_session

            elif subtype == "result":
                session["_completed"] = True
                result_text = data.get("result", "")
                yield ExecutionCompletedEvent(output={
                    "result": result_text,
                    "session_id": data.get("session_id"),
                    "cost_usd": data.get("total_cost_usd"),
                })

        elif msg_type == "assistant":
            message = data.get("message", {})
            content_blocks = message.get("content", [])

            if isinstance(content_blocks, str):
                yield ProgressUpdateEvent(content=content_blocks)
                return

            if not isinstance(content_blocks, list):
                return

            for block in content_blocks:
                block_type = block.get("type", "")

                if block_type == "thinking":
                    yield AgentThinkingEvent(content=block.get("thinking", ""))

                elif block_type == "text":
                    text = block.get("text", "")
                    yield ProgressUpdateEvent(content=text)

                elif block_type == "tool_use":
                    tool_name = block.get("name", "")
                    tool_input = block.get("input", {})
                    # 将工具调用事件交给 Engine 层做风险评估
                    yield ToolUseEvent(tool_name=tool_name, tool_input=tool_input)

        elif msg_type == "user":
            pass

    async def send_input(self, session_id: str, input_data: dict) -> None:
        """发送输入（stream-json 输入模式）"""
        session = self.sessions.get(session_id)
        if not session:
            return

        process: subprocess.Popen = session["process"]
        if process.stdin is None or process.returncode is not None:
            return

        msg = json.dumps({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": input_data.get("message", "")}]
            }
        }) + "\n"

        try:
            process.stdin.write(msg if isinstance(msg, str) else msg.encode())
            process.stdin.flush()
        except Exception:
            pass

    async def respond(self, session_id: str, approval_id: str, response: dict) -> None:
        """回复确认。MVP 策略：通过 --resume 重新执行"""
        session = self.sessions.get(session_id)
        if not session:
            return

        if response.get("approved"):
            cb_session_id = session.get("codebuddy_session_id")
            if cb_session_id:
                # 终止旧进程
                process: subprocess.Popen = session["process"]
                try:
                    process.kill()
                    process.wait(timeout=5)
                except Exception:
                    pass

                workspace = session["workspace"]
                prompt = "用户已确认，请继续执行"
                cmd = self._build_cmd(prompt, session.get("config", {}))
                cmd = [self._ensure_available(), "--resume", cb_session_id] + cmd[1:]

                resume_env = copy.copy(os.environ)
                skill_dir = session.get("config", {}).get("skill_dir")
                if skill_dir:
                    resume_env["SKILL_DIR"] = skill_dir

                loop = asyncio.get_event_loop()
                new_process = await loop.run_in_executor(
                    None, self._launch_process, cmd, workspace, resume_env
                )

                new_queue: asyncio.Queue[str | None] = asyncio.Queue()

                def _read_stdout(proc, q):
                    try:
                        for line in proc.stdout:
                            line_str = line.strip() if isinstance(line, str) else line.decode("utf-8", errors="replace").strip()
                            if line_str:
                                q.put_nowait(line_str)
                    except Exception as e:
                        logger.error(f"[Adapter] resume stdout read error: {e}")
                    finally:
                        q.put_nowait(None)

                reader_thread = threading.Thread(
                    target=_read_stdout,
                    args=(new_process, new_queue),
                    daemon=True,
                    name=f"cbc-resume-{session_id[:8]}",
                )
                reader_thread.start()

                session["process"] = new_process
                session["event_queue"] = new_queue
                session["reader_thread"] = reader_thread
                session["_completed"] = False
        else:
            process: subprocess.Popen = session["process"]
            try:
                process.kill()
            except Exception:
                pass

    async def resume_session(self, session_id: str, prompt: str) -> None:
        """恢复会话（多轮对话）— 用 cbc --resume 重新启动进程"""
        session = self.sessions.get(session_id)
        if not session:
            return

        cb_session_id = session.get("codebuddy_session_id")
        if not cb_session_id:
            return

        # 终止旧进程
        process: subprocess.Popen = session["process"]
        try:
            process.kill()
            process.wait(timeout=5)
        except Exception:
            pass

        workspace = session["workspace"]
        cmd = self._build_cmd(prompt, session.get("config", {}))
        cmd = [self._ensure_available(), "--resume", cb_session_id] + cmd[1:]

        resume_env = copy.copy(os.environ)
        skill_dir = session.get("config", {}).get("skill_dir")
        if skill_dir:
            resume_env["SKILL_DIR"] = skill_dir

        loop = asyncio.get_event_loop()
        new_process = await loop.run_in_executor(
            None, self._launch_process, cmd, workspace, resume_env
        )

        new_queue: asyncio.Queue[str | None] = asyncio.Queue()

        def _read_stdout(proc, q):
            try:
                for line in proc.stdout:
                    line_str = line.strip() if isinstance(line, str) else line.decode("utf-8", errors="replace").strip()
                    if line_str:
                        q.put_nowait(line_str)
            except Exception as e:
                logger.error(f"[Adapter] resume stdout read error: {e}")
            finally:
                q.put_nowait(None)

        reader_thread = threading.Thread(
            target=_read_stdout,
            args=(new_process, new_queue),
            daemon=True,
            name=f"cbc-resume-{session_id[:8]}",
        )
        reader_thread.start()

        session["process"] = new_process
        session["event_queue"] = new_queue
        session["reader_thread"] = reader_thread
        session["_completed"] = False

        logger.info(f"[Adapter] Resumed session={session_id[:8]} with cbc --resume {cb_session_id[:8]}")

    async def terminate(self, session_id: str) -> None:
        """终止会话"""
        session = self.sessions.pop(session_id, None)
        if session:
            process: subprocess.Popen = session["process"]
            if process.returncode is None:
                try:
                    process.kill()
                except Exception:
                    pass



# 全局单例
codebuddy_adapter = CodeBuddyAdapter()
