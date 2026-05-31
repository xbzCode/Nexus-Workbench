FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 暴露端口
EXPOSE 8000

# 启动：先跑迁移，再启动服务
CMD alembic --set sqlalchemy.url="$DATABASE_URL" upgrade head && \
    uvicorn app.main:app --host 0.0.0.0 --port 8000
