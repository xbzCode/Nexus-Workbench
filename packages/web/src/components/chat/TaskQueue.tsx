"use client";

import { AnimatePresence } from "framer-motion";
import TaskQueueItemCard from "./TaskQueueItemCard";
import type { TaskQueueItem } from "@/types/task-queue";

interface TaskQueueProps {
  tasks: TaskQueueItem[];
  activeTaskId?: string;
  onSelect: (id: string) => void;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
}

export default function TaskQueue({
  tasks,
  activeTaskId,
  onSelect,
  onRetry,
  onRemove,
}: TaskQueueProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="mt-6 w-full max-w-[580px]">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tasks</span>
        <span className="text-[10px] text-muted-foreground/50">{tasks.length}</span>
      </div>
      <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskQueueItemCard
              key={task.id}
              task={task}
              isActive={task.id === activeTaskId}
              onSelect={onSelect}
              onRetry={onRetry}
              onRemove={onRemove}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
