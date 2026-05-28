"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Calendar as CalendarIcon, Link as LinkIcon, Plus } from "lucide-react";

const API_URL = "http://localhost:8002/api/v1";

type Scheme = {
  id: number;
  scheme_name: string;
};

type Task = {
  id: number;
  task_name: string;
  start_date: string;
  end_date: string;
  progress_pct: number;
  depends_on: number | null;
};

export default function CPMEngine() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newTask, setNewTask] = useState({ task_name: "", start_date: "", end_date: "", depends_on: "" });

  useEffect(() => {
    fetch(`${API_URL}/schemes`)
      .then((res) => res.json())
      .then((data) => {
        setSchemes(data);
        if (data.length > 0) setSelectedScheme(data[0].id.toString());
      })
      .catch(() => console.error("Warning: Unable to load schemes from the backend."));
  }, []);

  useEffect(() => {
    if (selectedScheme) fetchTasks();
  }, [selectedScheme]);

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/cpm/${selectedScheme}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTask.task_name || !newTask.start_date || !newTask.end_date) {
      alert("Fill all mandatory task fields");
      return;
    }

    try {
      const payload = {
        ...newTask,
        depends_on: newTask.depends_on ? Number.parseInt(newTask.depends_on, 10) : null,
      };
      const res = await fetch(`${API_URL}/cpm/${selectedScheme}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setNewTask({ task_name: "", start_date: "", end_date: "", depends_on: "" });
        fetchTasks();
      }
    } catch (error) {
      console.error(error);
      alert("Failed to add task.");
    }
  };

  const getProjectTimeline = () => {
    if (tasks.length === 0) return { min: new Date(), max: new Date(), days: 1 };
    const starts = tasks.map((task) => new Date(task.start_date).getTime());
    const ends = tasks.map((task) => new Date(task.end_date).getTime());
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    const days = Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24)) || 1;
    return { min, max, days };
  };

  const { min: projectStart, days: totalDays } = getProjectTimeline();

  const getTaskStyle = (start: string, end: string) => {
    const taskStart = new Date(start);
    const taskEnd = new Date(end);
    const offsetDays = Math.max(0, (taskStart.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24));
    const durationDays = Math.max(1, (taskEnd.getTime() - taskStart.getTime()) / (1000 * 60 * 60 * 24));

    return {
      left: `${(offsetDays / totalDays) * 100}%`,
      width: `${(durationDays / totalDays) * 100}%`,
    };
  };

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">
      <div className="mb-10 flex items-end justify-between border-b border-zinc-800 pb-6">
        <div>
          <h1 className="mb-2 flex items-center gap-3 text-4xl font-bold tracking-tight">
            <BarChart3 className="h-8 w-8 text-blue-400" />
            CPM Engine
          </h1>
          <p className="text-lg text-zinc-400">Critical Path Method and timeline architecture</p>
        </div>
        <select
          value={selectedScheme}
          onChange={(event) => setSelectedScheme(event.target.value)}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg font-bold outline-none focus:border-blue-400"
        >
          {schemes.map((scheme) => (
            <option key={scheme.id} value={scheme.id}>[{scheme.id}] {scheme.scheme_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <div className="flex flex-col gap-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl xl:col-span-4">
          <h3 className="border-b border-zinc-800 pb-4 text-xl font-bold">Task Registry</h3>

          <div className="space-y-4">
            <input
              type="text"
              placeholder="Task Name (e.g. Foundation Pour)"
              value={newTask.task_name}
              onChange={(event) => setNewTask({ ...newTask, task_name: event.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 outline-none focus:border-blue-400"
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Start Date</label>
                <input
                  type="date"
                  value={newTask.start_date}
                  onChange={(event) => setNewTask({ ...newTask, start_date: event.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">End Date</label>
                <input
                  type="date"
                  value={newTask.end_date}
                  onChange={(event) => setNewTask({ ...newTask, end_date: event.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <select
              value={newTask.depends_on}
              onChange={(event) => setNewTask({ ...newTask, depends_on: event.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm outline-none focus:border-blue-400"
            >
              <option value="">No Dependency (Starts immediately)</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>Must wait for: {task.task_name}</option>
              ))}
            </select>
            <button onClick={handleAddTask} className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500/50 bg-blue-500/10 py-3 font-bold text-blue-400 transition-all hover:bg-blue-500 hover:text-white">
              <Plus className="h-5 w-5" /> Append Task
            </button>
          </div>

          <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm">
                <div>
                  <div className="font-bold text-zinc-300">{task.task_name}</div>
                  <div className="flex items-center gap-1 text-xs text-zinc-600"><CalendarIcon className="h-3 w-3" /> {task.start_date} to {task.end_date}</div>
                </div>
                {task.depends_on && <LinkIcon className="h-4 w-4 text-zinc-600" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl xl:col-span-8">
          <h3 className="mb-6 border-b border-zinc-800 pb-4 text-xl font-bold">Timeline Visualization</h3>

          <div className="relative flex-1 overflow-x-auto overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
            {isLoading ? (
              <div className="flex h-full w-full animate-pulse items-center justify-center text-blue-400">Rendering Timeline...</div>
            ) : tasks.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-zinc-600">Awaiting task data to generate Gantt sequence.</div>
            ) : (
              <div className="relative mt-8 min-w-[600px] space-y-4">
                <div className="pointer-events-none absolute inset-0 flex justify-between opacity-20">
                  {[...Array(10)].map((_, index) => (
                    <div key={index} className="h-full w-px bg-zinc-600" />
                  ))}
                </div>

                {tasks.map((task, index) => (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    key={task.id}
                    className="group relative flex h-12 w-full items-center"
                  >
                    <div className="absolute -top-4 z-10 whitespace-nowrap text-xs font-medium text-zinc-400" style={{ left: getTaskStyle(task.start_date, task.end_date).left }}>
                      {task.task_name}
                    </div>
                    <div className="absolute h-8 overflow-hidden rounded-lg border border-blue-500/50 bg-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)] transition-all group-hover:border-blue-400" style={getTaskStyle(task.start_date, task.end_date)}>
                      <div className="h-full bg-gradient-to-r from-blue-600 to-cyan-500" style={{ width: `${task.progress_pct}%` }} />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

