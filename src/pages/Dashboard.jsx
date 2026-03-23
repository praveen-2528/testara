import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { ChevronLeft, Trash2, TrendingUp, Target, Clock, Award, BarChart3 } from 'lucide-react';
import './Dashboard.css';

const Dashboard = () => {
    const navigate = useNavigate();
    const { authFetch, user } = useAuth();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        authFetch('/api/history')
            .then(r => r.json())
            .then(data => { setHistory(data.history || []); setLoading(false); })
            .catch(() => setLoading(false));
    }, [authFetch]);

    const stats = useMemo(() => {
        if (history.length === 0) return null;

        const totalTests = history.length;
        const avgScore = history.reduce((s, h) => s + (h.percentage || 0), 0) / totalTests;
        const bestScore = Math.max(...history.map(h => h.percentage || 0));
        const totalTime = history.reduce((s, h) => s + (h.totalTime || 0), 0);

        // Topic aggregation
        const topics = {};
        history.forEach(h => {
            if (!h.topicBreakdown) return;
            Object.entries(h.topicBreakdown).forEach(([topic, data]) => {
                if (!topics[topic]) topics[topic] = { correct: 0, total: 0 };
                topics[topic].correct += data.correct;
                topics[topic].total += data.total;
            });
        });

        // Sort topics by total questions (desc)
        const topicList = Object.entries(topics)
            .map(([name, data]) => ({
                name,
                correct: data.correct,
                total: data.total,
                accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10); // top 10 topics

        return { totalTests, avgScore, bestScore, totalTime, topicList };
    }, [history]);

    const formatDuration = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    const formatDate = (iso) => {
        const d = new Date(iso);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    };

    const handleClear = async () => {
        if (window.confirm('Clear all test history? This cannot be undone.')) {
            await authFetch('/api/history', { method: 'DELETE' });
            setHistory([]);
        }
    };

    // SVG line chart data (last 15 tests, oldest-first)
    const chartData = useMemo(() => {
        const recent = history.slice(0, 15).reverse(); // oldest first for chart
        if (recent.length < 2) return null;

        const W = 500, H = 200, P = 30;
        const maxY = 100; // percentage
        const stepX = (W - P * 2) / (recent.length - 1);

        const points = recent.map((h, i) => ({
            x: P + i * stepX,
            y: P + (1 - (h.percentage || 0) / maxY) * (H - P * 2),
            pct: (h.percentage || 0).toFixed(0),
            date: formatDate(h.date),
        }));

        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

        // Gradient fill area
        const areaD = pathD + ` L ${points[points.length - 1].x} ${H - P} L ${points[0].x} ${H - P} Z`;

        return { W, H, P, points, pathD, areaD, maxY };
    }, [history]);

    // Topic bar chart
    const maxTopicTotal = stats?.topicList?.length > 0 ? Math.max(...stats.topicList.map(t => t.total)) : 0;

    if (loading) {
        return (
            <div className="dashboard-container animate-fade-in">
                <div className="loading-screen"><div className="loading-spinner" /></div>
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <div className="dashboard-container animate-fade-in">
                <div className="dashboard-header">
                    <h1>📈 Performance Dashboard</h1>
                    <p>Track your progress across tests</p>
                </div>
                <Card className="empty-state glass">
                    <BarChart3 size={48} className="text-secondary" />
                    <h3>No Test History Yet</h3>
                    <p>Complete some tests to see your performance trends here!</p>
                    <Button variant="primary" onClick={() => navigate('/')}>Take a Test</Button>
                </Card>
                <div className="dashboard-back">
                    <Button variant="ghost" onClick={() => navigate('/')}><ChevronLeft size={16} /> Back</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-container animate-fade-in">
            <div className="dashboard-header">
                <h1>📈 Performance Dashboard</h1>
                <p>{stats.totalTests} tests completed</p>
            </div>

            {/* Stats Cards */}
            <div className="stats-row">
                <Card className="stat-card glass">
                    <TrendingUp size={24} className="stat-icon" />
                    <div className="stat-content">
                        <span className="stat-number">{stats.avgScore.toFixed(1)}%</span>
                        <span className="stat-label">Avg Score</span>
                    </div>
                </Card>
                <Card className="stat-card glass">
                    <Award size={24} className="stat-icon gold" />
                    <div className="stat-content">
                        <span className="stat-number">{stats.bestScore.toFixed(0)}%</span>
                        <span className="stat-label">Best Score</span>
                    </div>
                </Card>
                <Card className="stat-card glass">
                    <Target size={24} className="stat-icon" />
                    <div className="stat-content">
                        <span className="stat-number">{stats.totalTests}</span>
                        <span className="stat-label">Tests Taken</span>
                    </div>
                </Card>
                <Card className="stat-card glass">
                    <Clock size={24} className="stat-icon" />
                    <div className="stat-content">
                        <span className="stat-number">{formatDuration(stats.totalTime)}</span>
                        <span className="stat-label">Total Time</span>
                    </div>
                </Card>
            </div>

            {/* Score Trend Chart */}
            {chartData && (
                <Card className="chart-card glass">
                    <h3>Score Trend (Last {chartData.points.length} Tests)</h3>
                    <svg viewBox={`0 0 ${chartData.W} ${chartData.H}`} className="trend-chart">
                        {/* Grid lines */}
                        {[0, 25, 50, 75, 100].map(pct => {
                            const y = chartData.P + (1 - pct / 100) * (chartData.H - chartData.P * 2);
                            return (
                                <g key={pct}>
                                    <line x1={chartData.P} y1={y} x2={chartData.W - chartData.P} y2={y} className="grid-line" />
                                    <text x={chartData.P - 6} y={y + 4} className="axis-label" textAnchor="end">{pct}%</text>
                                </g>
                            );
                        })}
                        {/* Gradient fill */}
                        <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        <path d={chartData.areaD} fill="url(#areaGrad)" />
                        {/* Line */}
                        <path d={chartData.pathD} className="trend-line" />
                        {/* Points */}
                        {chartData.points.map((p, i) => (
                            <g key={i}>
                                <circle cx={p.x} cy={p.y} r="4" className="trend-dot" />
                                <title>{p.date}: {p.pct}%</title>
                            </g>
                        ))}
                    </svg>
                </Card>
            )}

            {/* Accuracy by Topic */}
            {stats.topicList.length > 0 && (
                <Card className="topics-card glass">
                    <h3>Accuracy by Topic</h3>
                    <div className="topic-bars">
                        {stats.topicList.map((t, i) => (
                            <div key={i} className="topic-row">
                                <span className="topic-name">{t.name}</span>
                                <div className="topic-bar-bg">
                                    <div
                                        className="topic-bar-fill"
                                        style={{
                                            width: `${t.accuracy}%`,
                                            background: t.accuracy >= 70 ? 'var(--success)' : t.accuracy >= 40 ? '#fbbf24' : 'var(--danger)',
                                        }}
                                    ></div>
                                </div>
                                <span className="topic-stat">{t.correct}/{t.total} ({t.accuracy.toFixed(0)}%)</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Recent Tests Table */}
            <Card className="recent-card glass">
                <h3>Recent Tests</h3>
                <div className="recent-table-wrap">
                    <table className="recent-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Score</th>
                                <th>Marks</th>
                                <th>Accuracy</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.slice(0, 10).map((h, i) => (
                                <tr key={i}>
                                    <td>{formatDate(h.date)}</td>
                                    <td>{h.correct}/{h.total}</td>
                                    <td className={h.totalMarks < 0 ? 'text-danger' : ''}>{h.totalMarks?.toFixed(1) || '—'}</td>
                                    <td>
                                        <span className={`pct-badge ${h.percentage >= 70 ? 'good' : h.percentage >= 40 ? 'avg' : 'low'}`}>
                                            {(h.percentage || 0).toFixed(0)}%
                                        </span>
                                    </td>
                                    <td>{formatDuration(h.totalTime || 0)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Actions */}
            <div className="dashboard-actions">
                <Button variant="ghost" onClick={() => navigate('/')}><ChevronLeft size={16} /> Back to Setup</Button>
                <Button variant="outline" onClick={handleClear} className="danger-btn"><Trash2 size={16} /> Clear History</Button>
            </div>
        </div>
    );
};

export default Dashboard;
