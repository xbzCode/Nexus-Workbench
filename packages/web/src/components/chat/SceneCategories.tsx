"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { FileText, Code, BarChart3, BookOpen } from "lucide-react";
import type { SceneCategory } from "@/types/task-queue";

const SCENE_CATEGORIES: (SceneCategory & { Icon: React.ComponentType<{ className?: string }> })[] = [
  {
    Icon: FileText,
    name: "内容生成",
    hint: "文案、报告、翻译",
    color: "text-violet-400",
    prompt: "帮我进行内容创作，比如撰写文案、生成报告或翻译内容",
    icon: "FileText",
  },
  {
    Icon: Code,
    name: "代码开发",
    hint: "功能开发、Bug修复",
    color: "text-blue-400",
    prompt: "帮我进行代码开发工作，包括新功能开发、Bug修复或代码重构",
    icon: "Code",
  },
  {
    Icon: BarChart3,
    name: "数据分析",
    hint: "清洗、可视化",
    color: "text-emerald-400",
    prompt: "帮我进行数据分析工作，包括数据清洗、统计分析和可视化报表",
    icon: "BarChart3",
  },
  {
    Icon: BookOpen,
    name: "文档处理",
    hint: "接口文档、技术方案",
    color: "text-amber-400",
    prompt: "帮我处理文档相关的工作，比如编写接口文档或技术方案",
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
      className="mt-8 grid w-full max-w-[560px] grid-cols-2 gap-2.5 sm:grid-cols-4"
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
            className="group flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card/50 px-3.5 py-3 text-left transition-colors hover:border-brand/30 hover:bg-surface-hover"
            onClick={() => onSelect(cat.prompt)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            <Icon className={cn("h-4 w-4", cat.color)} />
            <span className="text-[13px] leading-snug text-foreground font-medium">{cat.name}</span>
            <span className="text-[11px] text-muted-foreground">{cat.hint}</span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
