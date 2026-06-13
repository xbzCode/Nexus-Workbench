"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { FileText, Code, BarChart3, BookOpen } from "lucide-react";
import type { SceneCategory } from "@/types/task-queue";

const SCENE_CATEGORIES: (SceneCategory & { Icon: React.ComponentType<{ className?: string }> })[] = [
  {
    Icon: FileText,
    name: "帮我写简历",
    hint: "根据经历生成专业简历",
    color: "text-violet-400",
    prompt: "帮我写一份专业的AI开发工程师的简历",
    icon: "FileText",
  },
  {
    Icon: Code,
    name: "高考志愿填报",
    hint: "AI 分析最优院校专业",
    color: "text-blue-400",
    prompt: "帮我分析高考志愿填报方案，我考了620分，四川理科，想学计算机相关专业",
    icon: "Code",
  },
  {
    Icon: BarChart3,
    name: "架构图生成",
    hint: "根据内容生成架构图",
    color: "text-emerald-400",
    prompt: "帮编写一个关于微前端microapp的架构图",
    icon: "BarChart3",
  },
  {
    Icon: BookOpen,
    name: "PPT编写",
    hint: "生成于中国美食的ppt",
    color: "text-amber-400",
    prompt: "帮我写一个关于中国美食的ppt，要求内容丰富，图片精美，配色和谐",
    icon: "BookOpen",
  },
];

const customEase: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const fadeSlideUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: customEase } },
};

interface SceneCategoriesProps {
  onSelect: (prompt: string) => void;
}

export default function SceneCategories({ onSelect }: SceneCategoriesProps) {
  return (
    <motion.div
      className="mt-10 grid w-full max-w-[580px] grid-cols-2 gap-3 sm:grid-cols-4"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {SCENE_CATEGORIES.map((cat) => {
        const Icon = cat.Icon;
        return (
          <motion.button
            key={cat.name}
            variants={fadeSlideUp}
            className="group relative flex flex-col gap-2 rounded-xl border border-border/50 bg-card/60 px-4 py-4 text-left transition-all duration-200 hover:border-brand/30 hover:bg-gradient-to-b hover:from-brand/[0.06] hover:to-transparent hover:shadow-lg hover:shadow-brand/[0.04] hover:-translate-y-0.5"
            onClick={() => onSelect(cat.prompt)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
          >
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-muted/70 group-hover:bg-[currentColor]/10 transition-colors", cat.color)}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[13px] leading-snug text-foreground font-semibold">{cat.name}</span>
            <span className="text-[11px] text-muted-foreground/70 leading-relaxed">{cat.hint}</span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
