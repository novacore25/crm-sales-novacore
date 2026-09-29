"use client";
import React, { useState, useEffect } from 'react';
import type { TaskDTO, UserProfile, LeadOption } from '@/types';
import { deleteTask, setTaskStatus } from '@/app/actions/task-actions';
import { useRouter } from 'next/navigation';
import { Plus, Search, Calendar, Clock, User, CheckCircle2, Circle, AlertCircle, Trash2, Edit3, Filter, Loader2, ClipboardCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import TaskModal from './TaskModal';
import ConfirmModal from './ConfirmModal';

type TaskStatus = 'Todo' | 'In Progress' | 'Done';

interface TasksProps {
  initialTasks: TaskDTO[];
  user: UserProfile;
  users: UserProfile[];
  leadOptions: LeadOption[];
  /** Modal element rendered by the page. Inert unless the page wires it up. */
  modal?: React.ReactNode;
}

export default function TasksClient({ initialTasks, user, users, leadOptions, modal }: TasksProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskDTO[]>(initialTasks || []);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'All'>('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDTO | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm });
  };

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase()) ||
      t.assignedToName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'All' || t.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleToggleStatus = async (task: TaskDTO) => {
    const nextStatus: TaskStatus =
      task.status === 'Todo' ? 'In Progress' : task.status === 'In Progress' ? 'Done' : 'Todo';
    try {
      const result = await setTaskStatus(task.id, nextStatus);
      if (!result.success) {
        toast.error('Failed to update task status: ' + (result.error ?? 'Tidak diizinkan'));
        return;
      }
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
      router.refresh();
      toast.success(`Task moved to ${nextStatus}`);
    } catch {
      toast.error('Failed to update task status');
    }
  };

  const handleDeleteTask = async (id: string) => {
    showConfirm('Hapus Task', 'Apakah Anda yakin ingin menghapus task ini? Tindakan ini tidak dapat dibatalkan.', async () => {
      try {
        const result = await deleteTask(id);
        if (!result.success) {
          toast.error('Failed to delete task: ' + (result.error ?? 'Tidak diizinkan'));
          return;
        }
        setTasks((prev) => prev.filter((t) => t.id !== id));
        router.refresh();
        toast.success('Task deleted');
      } catch {
        toast.error('Failed to delete task');
      }
    });
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tight">Sales Tasks</h2>
          <p className="text-slate-500 font-medium mt-1">Manage and track your team's sales activities</p>
        </div>
        <button
          onClick={() => {
            setEditingTask(null);
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create New Task
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative col-span-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search tasks, descriptions, or assignees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl font-medium focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as TaskStatus | 'All')}
            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm appearance-none"
          >
            <option value="All">All Status</option>
            <option value="Todo">Todo</option>
            <option value="In Progress">In Progress</option>
            <option value="Done">Done</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
          <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Synchronizing Tasks...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] py-20 flex flex-col items-center justify-center text-center px-6">
          <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-6">
            <ClipboardCheck className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-black text-slate-900">No tasks found</h3>
          <p className="text-slate-500 max-w-xs mt-2">
            Try adjusting your search or filters, or create a new task to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => handleToggleStatus(task)}
              onDelete={() => handleDeleteTask(task.id)}
              onEdit={() => {
                setEditingTask(task);
                setIsModalOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <TaskModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTask(null);
          router.refresh();
        }}
        user={user}
        users={users}
        leadOptions={leadOptions}
        editingTask={editingTask}
      />

      {modal}

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
      />
    </div>
  );
}

interface TaskCardProps {
  task: TaskDTO;
  onToggle: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onEdit: () => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onToggle, onDelete, onEdit }) => {
  const router = useRouter();
  const isOverdue = new Date(task.dueDate) < new Date() && task.status !== 'Done';

  const priorityColors: Record<string, string> = {
    Low: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    Medium: 'bg-amber-50 text-amber-600 border-amber-100',
    High: 'bg-rose-50 text-rose-600 border-rose-100',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    Todo: <Circle className="w-6 h-6 text-slate-300" />,
    'In Progress': <Clock className="w-6 h-6 text-indigo-500" />,
    Done: <CheckCircle2 className="w-6 h-6 text-emerald-500" />,
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm hover:shadow-xl transition-all group"
    >
      <div className="flex justify-between items-start mb-4">
        <button onClick={onToggle} className="hover:scale-110 transition-transform">
          {statusIcons[task.status] ?? statusIcons.Todo}
        </button>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-indigo-600 transition-colors"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-rose-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <h4
        className={cn(
          'text-lg font-black text-slate-900 mb-2 leading-tight',
          task.status === 'Done' && 'line-through text-slate-400',
        )}
      >
        {task.title}
      </h4>

      {task.description && <p className="text-slate-500 text-sm mb-4 line-clamp-2">{task.description}</p>}

      <div className="space-y-3 pt-4 border-t border-slate-50">
        <div className="flex items-center justify-between">
          <div
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border',
              priorityColors[task.priority] ?? priorityColors.Medium,
            )}
          >
            <AlertCircle className="w-3 h-3" />
            {task.priority}
          </div>
          <div
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider',
              isOverdue ? 'text-rose-500' : 'text-slate-400',
            )}
          >
            <Calendar className="w-3 h-3" />
            {task.dueDate}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-500">
            {task.assignedToName.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs font-bold text-slate-600">{task.assignedToName}</span>
          {task.leadName && (
            <button
              onClick={() => task.leadId && router.push(`/lead/${task.leadId}`)}
              className="ml-auto text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md hover:bg-indigo-100 transition-colors"
            >
              {task.leadName}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
