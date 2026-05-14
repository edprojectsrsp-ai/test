// app/schedule/page.tsx
"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Upload, 
  BarChart3, 
  Calendar, 
  ChevronRight,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp
} from "lucide-react";

interface Project {
  id: number;
  name: string;
  type: string;
  status: string;
}

interface Activity {
  id: number;
  activity_code: string;
  activity_name: string;
  duration_days: number;
  start_date: string;
  finish_date: string;
  actual_start: string;
  actual_finish: string;
  percent_complete: number;
  predecessors: string;
  successors: string;
  early_start: string;
  early_finish: string;
  late_start: string;
  late_finish: string;
  total_float: number;
  is_critical: string;
}

interface AnalysisResult {
  total_activities: number;
  critical_activities: number;
  completed_activities: number;
  average_progress: number;
  total_duration_days: number;
  critical_path: Array<{
    code: string;
    name: string;
    early_start: string;
    early_finish: string;
    float: number;
  }>;
}

export default function SchedulePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('http://localhost:5001/api/projects');
      const data = await response.json();
      setProjects(data.filter((p: Project) => p.type === 'corporate'));
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects');
    }
  };

  const fetchSchedule = async (projectId: number) => {
    try {
      const response = await fetch(`http://localhost:5001/api/schedule/${projectId}`);
      const data = await response.json();
      setScheduleId(data.schedule_id);
      setActivities(data.activities);
      setShowSchedule(true);
      setAnalysis(null);
      
      if (data.schedule_id && data.activities.length > 0) {
        await analyzeSchedule(data.schedule_id);
      }
    } catch (err) {
      console.error('Error fetching schedule:', err);
      setError('Failed to load schedule');
    }
  };

  const analyzeSchedule = async (id: number) => {
    setAnalyzing(true);
    try {
      const response = await fetch(`http://localhost:5001/api/schedule/analyze/${id}`);
      const data = await response.json();
      setAnalysis(data);
    } catch (err) {
      console.error('Error analyzing schedule:', err);
      setError('Failed to analyze schedule');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleProjectSelect = (projectId: number) => {
    setSelectedProject(projectId);
    fetchSchedule(projectId);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProject) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', selectedProject.toString());

    try {
      const response = await fetch('http://localhost:5001/api/schedule/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (response.ok) {
        await fetchSchedule(selectedProject);
        alert(`Schedule uploaded successfully! ${data.activity_count} activities imported.`);
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Error uploading:', err);
      setError('Failed to upload schedule');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleAnalyze = async () => {
    if (scheduleId) {
      await analyzeSchedule(scheduleId);
    }
  };

  const StatCard = ({ title, value, icon, color }: any) => (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-zinc-400 text-sm">{title}</span>
        <div className={`p-2 rounded-xl bg-${color}-500/10`}>{icon}</div>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.08)_0%,transparent_60%)] p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
            <Calendar className="w-8 h-8 text-cyan-400" />
            Schedule Manager
          </h1>
          <p className="text-zinc-400">Upload Primavera schedules, analyze critical path, track project progress</p>
        </div>

        {/* Project Selection */}
        {!showSchedule && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8"
          >
            <h2 className="text-2xl font-semibold mb-6">Select Corporate Scheme</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleProjectSelect(project.id)}
                  className="text-left p-6 bg-zinc-800/50 hover:bg-zinc-800 rounded-2xl border border-zinc-700 transition-all hover:border-cyan-400 group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-cyan-400 text-sm uppercase tracking-wide">Scheme</span>
                    <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-1">{project.name}</h3>
                  <p className="text-zinc-400 text-sm capitalize">{project.status}</p>
                </button>
              ))}
            </div>
            {projects.length === 0 && (
              <div className="text-center py-12 text-zinc-500">
                <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No corporate schemes found. Create a scheme first.</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Schedule View */}
        {showSchedule && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Back button */}
            <button
              onClick={() => {
                setShowSchedule(false);
                setActivities([]);
                setAnalysis(null);
                setScheduleId(null);
              }}
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-4"
            >
              ← Back to Projects
            </button>

            {/* Upload Section */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">
                    {projects.find(p => p.id === selectedProject)?.name}
                  </h2>
                  <p className="text-zinc-400 text-sm mt-1">
                    {activities.length} activities • {scheduleId ? 'Schedule loaded' : 'No schedule uploaded'}
                  </p>
                </div>
                <div className="flex gap-3">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".xml,.xer"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                    <div className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
                      uploading 
                        ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                        : 'bg-cyan-500 text-black hover:bg-cyan-400'
                    }`}>
                      {uploading ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5" />
                      )}
                      {uploading ? 'Uploading...' : 'Upload Revised Schedule'}
                    </div>
                  </label>
                  
                  {scheduleId && activities.length > 0 && (
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-emerald-500 text-black hover:bg-emerald-400 transition-all"
                    >
                      {analyzing ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <BarChart3 className="w-5 h-5" />
                      )}
                      {analyzing ? 'Analyzing...' : 'Analyze Schedule'}
                    </button>
                  )}
                </div>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  {error}
                </div>
              )}
            </div>

            {/* Analysis Results */}
            {analysis && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    title="Total Activities"
                    value={analysis.total_activities}
                    icon={<Calendar className="w-5 h-5 text-cyan-400" />}
                    color="cyan"
                  />
                  <StatCard
                    title="Critical Activities"
                    value={analysis.critical_activities}
                    icon={<AlertCircle className="w-5 h-5 text-red-400" />}
                    color="red"
                  />
                  <StatCard
                    title="Completed"
                    value={`${analysis.completed_activities} / ${analysis.total_activities}`}
                    icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                    color="emerald"
                  />
                  <StatCard
                    title="Average Progress"
                    value={`${analysis.average_progress}%`}
                    icon={<TrendingUp className="w-5 h-5 text-blue-400" />}
                    color="blue"
                  />
                </div>

                {/* Critical Path */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                  <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-red-400" />
                    Critical Path ({analysis.critical_activities} activities)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Activity ID</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Activity Name</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Early Start</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Early Finish</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Float</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.critical_path.map((activity, idx) => (
                          <tr key={idx} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                            <td className="py-3 px-4 text-cyan-400 font-mono text-sm">{activity.code}</td>
                            <td className="py-3 px-4 text-white">{activity.name}</td>
                            <td className="py-3 px-4 text-zinc-300">{activity.early_start}</td>
                            <td className="py-3 px-4 text-zinc-300">{activity.early_finish}</td>
                            <td className="py-3 px-4 text-yellow-400">{activity.float.toFixed(2)} days</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Activities Table */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                  <h3 className="text-xl font-semibold mb-4">All Activities</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Code</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Name</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Duration</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Progress</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Early Start</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Early Finish</th>
                          <th className="text-left py-3 px-4 text-zinc-400 font-medium">Float</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activities.map((activity) => (
                          <tr 
                            key={activity.id} 
                            className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${
                              activity.is_critical === 'Y' ? 'bg-red-500/5' : ''
                            }`}
                          >
                            <td className="py-3 px-4 font-mono text-sm text-cyan-400">{activity.activity_code}</td>
                            <td className="py-3 px-4 text-white">{activity.activity_name}</td>
                            <td className="py-3 px-4 text-zinc-300">{activity.duration_days.toFixed(1)} d</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-300">{activity.percent_complete}%</span>
                                <div className="flex-1 max-w-[100px] bg-zinc-800 rounded-full h-2 overflow-hidden">
                                  <div 
                                    className="bg-emerald-500 h-full rounded-full transition-all"
                                    style={{ width: `${activity.percent_complete}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-zinc-300">{activity.early_start || '-'}</td>
                            <td className="py-3 px-4 text-zinc-300">{activity.early_finish || '-'}</td>
                            <td className={`py-3 px-4 ${activity.total_float <= 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {activity.total_float.toFixed(2)} d
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* No schedule message */}
            {!scheduleId && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-12 text-center">
                <Upload className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                <h3 className="text-xl font-semibold mb-2">No Schedule Uploaded</h3>
                <p className="text-zinc-400 mb-6">
                  Upload a Primavera P6 XML or XER file to start CPM analysis
                </p>
                <label className="cursor-pointer inline-block">
                  <input
                    type="file"
                    accept=".xml,.xer"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <div className="px-8 py-4 bg-cyan-500 text-black rounded-xl font-semibold hover:bg-cyan-400 transition-all cursor-pointer">
                    {uploading ? 'Uploading...' : 'Upload Schedule File'}
                  </div>
                </label>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}