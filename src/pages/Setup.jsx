import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExam } from '../context/ExamContext';
import { useAuth } from '../context/AuthContext';
import { EXAM_TEMPLATES } from '../utils/examTemplates';
import { parseCSVString } from '../utils/csvParser';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { 
    BookOpen, AlertCircle, Users, Folder, BarChart3, LogOut, Settings as SettingsIcon, 
    Trophy, Library, LayoutTemplate, Sparkles, Loader, UserPlus, FileSpreadsheet, 
    TrendingUp, Clock, PlayCircle, ChevronLeft, Crown, Medal, ArrowUpRight, Activity, 
    UserCheck, Globe, Star, Copy, ClipboardCheck, Layers, Target
} from 'lucide-react';
import './Setup.css';

const Setup = () => {
    const { examType, testFormat, updateExamState } = useExam();
    const { user, logout, authFetch } = useAuth();
    const navigate = useNavigate();

    const [step, setStep] = useState(0); // 0 = Home Dashboard, 1 = Exam, 2 = Format, 3 = Data
    const [error, setError] = useState('');
    const [csvInput, setCsvInput] = useState('');

    // Form selections for Generating
    const [questionSource, setQuestionSource] = useState('ai');
    const [selectedSubject, setSelectedSubject] = useState('');
    const [selectedTopic, setSelectedTopic] = useState('');
    const [topicQuestionCount, setTopicQuestionCount] = useState(10);
    const [generatedPrompt, setGeneratedPrompt] = useState('');
    const [promptCopied, setPromptCopied] = useState(false);

    // Mocks state
    const [savedMocks, setSavedMocks] = useState([]);
    const [selectedMockId, setSelectedMockId] = useState('');

    const [markingPreset, setMarkingPreset] = useState('ssc');
    const [customMarks, setCustomMarks] = useState({ correct: 2, incorrect: -0.5, unattempted: 0 });

    // Question Bank generation
    const [bankSubject, setBankSubject] = useState('all');
    const [bankCount, setBankCount] = useState(25);
    const [bankSubjects, setBankSubjects] = useState([]);
    const [bankLoading, setBankLoading] = useState(false);

    // Dashboard Data
    const [history, setHistory] = useState([]);
    const [stats, setStats] = useState({ totalTests: 0, avgScore: 0, totalTime: 0 });
    const [leaderboard, setLeaderboard] = useState([]);
    const [friends, setFriends] = useState([]);
    const [loadingStats, setLoadingStats] = useState(true);

    const markingPresets = {
        ssc: { correct: 2, incorrect: -0.5, unattempted: 0, label: 'SSC Standard (+2 / -0.50)' },
        none: { correct: 1, incorrect: 0, unattempted: 0, label: 'No Negative (+1 / 0)' },
    };

    useEffect(() => {
        if (user) {
            Promise.all([
                authFetch('/api/mocks').then(r => r.json()).catch(() => ({})),
                authFetch('/api/history').then(r => r.json()).catch(() => ({})),
                authFetch('/api/leaderboard').then(r => r.json()).catch(() => ({})),
                authFetch('/api/friends').then(r => r.json()).catch(() => ({}))
            ]).then(([mocksData, histData, leadData, friendsData]) => {
                setSavedMocks(mocksData.mocks || []);
                
                const hist = histData.history || [];
                setHistory(hist);
                if (hist.length > 0) {
                    const totalTests = hist.length;
                    const avgScore = hist.reduce((s, h) => s + (h.percentage || 0), 0) / totalTests;
                    const totalTime = hist.reduce((s, h) => s + (h.totalTime || 0), 0);
                    setStats({ totalTests, avgScore, totalTime });
                }

                setLeaderboard(leadData.leaderboard || []);
                setFriends(friendsData.friends || []);
                
                setLoadingStats(false);
            });
        } else {
            setLoadingStats(false);
        }
    }, [user, authFetch]);

    useEffect(() => {
        if (user && examType && step > 0) {
            authFetch(`/api/questions?limit=1&exam_type=${examType}`)
                .then(r => r.json())
                .then(data => setBankSubjects(data.subjects || []))
                .catch(() => { });
        }
    }, [user, examType, authFetch, step]);

    const getActiveScheme = () => {
        if (markingPreset === 'custom') return customMarks;
        return markingPresets[markingPreset];
    };

    const handleExamTypeSelect = (type) => {
        updateExamState({ examType: type });
        setStep(2);
    };

    const handleFormatSelect = (format) => {
        updateExamState({ testFormat: format });
        if (format === 'full') {
            setStep(3);
        }
    };

    const currentTemplate = EXAM_TEMPLATES[examType];
    const currentSubjectObj = currentTemplate?.subjects?.find(s => s.id === selectedSubject) || currentTemplate?.subjects?.[0];

    const generatePrompt = () => {
        if (!currentTemplate) return;

        const optionsCount = currentTemplate.optionsPerQuestion || 4;
        const optionLetters = Array.from({ length: optionsCount }, (_, i) => String.fromCharCode(65 + i));
        const optionHeaders = optionLetters.map(L => `option_${L.toLowerCase()}`).join(',');

        let subjectInfo = '';
        let topicInfo = '';
        let questionCount = topicQuestionCount;

        if (testFormat === 'full') {
            subjectInfo = currentTemplate.subjects.map(s => `- ${s.name}: ${s.count} questions`).join('\n');
            questionCount = currentTemplate.totalQuestions;
        } else if (testFormat === 'subject') {
            if (!currentSubjectObj) return setError('Please select a subject.');
            subjectInfo = currentSubjectObj.name;
            questionCount = currentSubjectObj.count || topicQuestionCount;
        } else if (testFormat === 'topic') {
            if (!currentSubjectObj || !selectedTopic) return setError('Please select a subject and topic.');
            subjectInfo = currentSubjectObj.name;
            topicInfo = `Topic: ${selectedTopic}`;
            questionCount = topicQuestionCount;
        }

        const prompt = `Generate exactly ${questionCount} multiple-choice questions for ${currentTemplate.name} exam in CSV format.

REQUIREMENTS:
- Exam: ${currentTemplate.name}
${testFormat === 'full' ? `- Full Mock Test covering all subjects:\n${subjectInfo}` : `- Subject: ${subjectInfo}\n${topicInfo ? `- ${topicInfo}` : ''}`}
- Difficulty: Mix of easy, medium, and hard
- Each question must have exactly ${optionsCount} options (${optionLetters.join(', ')})

OUTPUT FORMAT:
Return ONLY a CSV with these exact headers (no extra text, no explanations, no markdown):

question,${optionHeaders},correct_option,explanation,subject,topic,subtopic,difficulty,question_type,exam_type

RULES:
- correct_option must be a single letter (${optionLetters.join(', ')})
- question_type should be: MCQ
- exam_type should be: ${examType}
- Wrap any field containing commas in double quotes
- Generate exam-level questions suitable for ${currentTemplate.name}
- Each question should have a clear, concise explanation
- Use proper subject/topic/subtopic TAGS matching the syllabus

START OUTPUT WITH THE CSV HEADER ROW DIRECTLY. NO OTHER TEXT.`;

        setGeneratedPrompt(prompt);
    };

    const copyPrompt = async () => {
        await navigator.clipboard.writeText(generatedPrompt);
        setPromptCopied(true);
        setTimeout(() => setPromptCopied(false), 2000);
    };

    const startSavedMock = async () => {
        if (!selectedMockId) return setError('Please select a saved mock test.');
        try {
            const res = await authFetch(`/api/mocks/${selectedMockId}/start`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            const template = EXAM_TEMPLATES[data.mock.exam_template_id];
            updateExamState({
                questions: data.questions,
                testStarted: true,
                markingScheme: template ? template.markingScheme : getActiveScheme(),
                examType: template ? template.id : examType
            });
            navigate('/test');
        } catch (err) {
            setError(err.message);
        }
    };

    const startFromBank = async () => {
        setError('');
        setBankLoading(true);
        try {
            const res = await authFetch('/api/questions/generate-for-room', {
                method: 'POST',
                body: JSON.stringify({ examType, subject: bankSubject, count: bankCount }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            if (!data.questions || data.questions.length === 0) throw new Error('No questions found.');
            updateExamState({ questions: data.questions, testStarted: true, markingScheme: getActiveScheme() });
            navigate('/test');
        } catch (err) { setError(err.message); }
        setBankLoading(false);
    };

    const handleCSVParse = () => {
        if (!csvInput.trim()) return;
        setError('');
        let cleaned = csvInput.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:csv)?\n?/, '').replace(/\n?```$/, '');
        }

        const result = parseCSVString(cleaned, {
            examType,
            subject: currentSubjectObj?.name || '',
            topic: selectedTopic || ''
        });
        if (result.questions.length > 0) {
            for (let i = result.questions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [result.questions[i], result.questions[j]] = [result.questions[j], result.questions[i]];
            }
            updateExamState({ questions: result.questions, testStarted: true, markingScheme: getActiveScheme() });
            navigate('/test');
        } else {
            setError(result.errors.length > 0 ? result.errors.slice(0, 2).join('; ') : 'No valid questions found.');
        }
    };

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

    // --- HOME DASHBOARD VIEW ---
    if (step === 0) {
        return (
            <div className="home-wrapper animate-fade-in">
                {/* Global Top Nav */}
                <nav className="home-top-nav">
                    <div className="nav-brand">
                        <div className="brand-logo"><Sparkles size={20} /></div>
                        <span>Testara Dashboard</span>
                    </div>
                    <div className="nav-actions">
                        <span className="nav-greeting">Hi, {user?.name.split(' ')[0] || 'Guest'}</span>
                        <div className="nav-divider"></div>
                        <button className="nav-icon-btn" onClick={() => navigate('/settings')} title="Settings"><SettingsIcon size={18} /></button>
                        <button className="nav-icon-btn danger" onClick={logout} title="Logout"><LogOut size={18} /></button>
                    </div>
                </nav>

                <div className="dashboard-grid">
                    {/* LEFT COLUMN: Main Area */}
                    <div className="dashboard-main">
                        <div className="hero-banner glass">
                            <div className="hero-content">
                                <h1>Ready to level up?</h1>
                                <p>Your personalized practice dashboard. Dive back in or start a new challenge today.</p>
                                <Button variant="primary" className="hero-btn" onClick={() => setStep(1)}>
                                    <PlayCircle size={18} /> Start Practice
                                </Button>
                            </div>
                            <div className="hero-graphics">
                                <Activity size={100} className="hero-bg-icon" />
                            </div>
                        </div>

                        {!loadingStats && (
                            <div className="kpi-row">
                                <Card className="kpi-card glass">
                                    <div className="kpi-icon-wrap blue"><TrendingUp size={20} /></div>
                                    <div className="kpi-info">
                                        <span className="kpi-val">{stats.avgScore.toFixed(1)}%</span>
                                        <span className="kpi-label">Avg Accuracy</span>
                                    </div>
                                </Card>
                                <Card className="kpi-card glass">
                                    <div className="kpi-icon-wrap purp"><BookOpen size={20} /></div>
                                    <div className="kpi-info">
                                        <span className="kpi-val">{stats.totalTests}</span>
                                        <span className="kpi-label">Tests Taken</span>
                                    </div>
                                </Card>
                                <Card className="kpi-card glass">
                                    <div className="kpi-icon-wrap green"><Clock size={20} /></div>
                                    <div className="kpi-info">
                                        <span className="kpi-val">{formatDuration(stats.totalTime) || '0m'}</span>
                                        <span className="kpi-label">Time Spent</span>
                                    </div>
                                </Card>
                            </div>
                        )}

                        <div className="section-header">
                            <h2>Quick Tools</h2>
                        </div>
                        <div className="action-hub-grid">
                            <button className="action-card glass" onClick={() => navigate('/lobby')}>
                                <div className="ac-top">
                                    <div className="ac-icon primary"><Users size={24} /></div>
                                    <ArrowUpRight size={18} className="ac-arrow" />
                                </div>
                                <div className="ac-bottom">
                                    <h3>Multiplayer</h3>
                                    <p>Host or join live exam rooms</p>
                                </div>
                            </button>
                            <button className="action-card glass" onClick={() => navigate('/ai-generator')}>
                                <div className="ac-top">
                                    <div className="ac-icon ai"><Sparkles size={24} /></div>
                                    <ArrowUpRight size={18} className="ac-arrow" />
                                </div>
                                <div className="ac-bottom">
                                    <h3>AI Generate</h3>
                                    <p>Create full mock tests with AI</p>
                                </div>
                            </button>
                            <button className="action-card glass" onClick={() => navigate('/mock-builder')}>
                                <div className="ac-top">
                                    <div className="ac-icon success"><LayoutTemplate size={24} /></div>
                                    <ArrowUpRight size={18} className="ac-arrow" />
                                </div>
                                <div className="ac-bottom">
                                    <h3>Mock Builder</h3>
                                    <p>Combine banks into custom sets</p>
                                </div>
                            </button>
                            <button className="action-card glass" onClick={() => navigate('/question-bank')}>
                                <div className="ac-top">
                                    <div className="ac-icon warning"><Library size={24} /></div>
                                    <ArrowUpRight size={18} className="ac-arrow" />
                                </div>
                                <div className="ac-bottom">
                                    <h3>Question Bank</h3>
                                    <p>Review and edit saved questions</p>
                                </div>
                            </button>
                        </div>

                        <div className="section-header">
                            <h2>Recent Activity</h2>
                            <button className="view-all-text" onClick={() => navigate('/dashboard')}>Full Analytics</button>
                        </div>
                        <Card className="activity-card glass">
                            {history.length > 0 ? (
                                <div className="activity-list">
                                    {history.slice(0, 4).map((h, i) => (
                                        <div className="activity-item" key={i}>
                                            <div className="act-type">
                                                <div className={`act-icon ${h.percentage >= 70 ? 'good' : h.percentage >= 40 ? 'avg' : 'low'}`}>
                                                    <Trophy size={16} />
                                                </div>
                                                <div className="act-details">
                                                    <span className="act-title">{h.examType ? h.examType.toUpperCase() : 'Custom Test'}</span>
                                                    <span className="act-date">{formatDate(h.date)} • {formatDuration(h.totalTime || 0)}</span>
                                                </div>
                                            </div>
                                            <div className="act-score">
                                                <span className={`score-badge ${h.percentage >= 70 ? 'good' : h.percentage >= 40 ? 'avg' : 'low'}`}>
                                                    {(h.percentage || 0).toFixed(0)}%
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="empty-state-mini">
                                    <Star size={32} className="text-secondary opacity-50 mb-2" />
                                    <p>No activity yet. Your journey begins today!</p>
                                </div>
                            )}
                        </Card>
                    </div>

                    {/* RIGHT COLUMN: Sidebar Context */}
                    <div className="dashboard-sidebar">
                        <Card className="profile-card glass">
                            <div className="profile-header">
                                <div className="profile-avatar">
                                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                                </div>
                                <div className="profile-names">
                                    <h3>{user?.name || 'User'}</h3>
                                    <span>{user?.email || 'Student'}</span>
                                </div>
                            </div>
                            <div className="profile-stats">
                                <div className="p-stat">
                                    <span className="p-val">{stats.totalTests}</span>
                                    <span className="p-lbl">Tests</span>
                                </div>
                                <div className="p-stat">
                                    <span className="p-val">{stats.avgScore.toFixed(0)}%</span>
                                    <span className="p-lbl">Avg</span>
                                </div>
                            </div>
                        </Card>

                        <Card className="sidebar-widget glass">
                            <div className="widget-header">
                                <h3><Globe size={16}/> Top Performers</h3>
                                <button onClick={() => navigate('/global-leaderboard')} className="widget-link">All</button>
                            </div>
                            <div className="widget-content">
                                {leaderboard.length > 0 ? (
                                    <div className="mini-lb">
                                        {leaderboard.slice(0, 3).map((lb, i) => (
                                            <div className="mini-lb-item" key={lb.id}>
                                                <div className="lb-left">
                                                    <div className="lb-rank">
                                                        {i === 0 ? <Crown size={14} className="gold"/> : 
                                                         i === 1 ? <Medal size={14} className="silver"/> : 
                                                         i === 2 ? <Medal size={14} className="bronze"/> : `#${i+1}`}
                                                    </div>
                                                    <span className="lb-name">{lb.name.split(' ')[0]}</span>
                                                </div>
                                                <span className="lb-score">{lb.avg_score}%</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="empty-text">No data yet</span>
                                )}
                            </div>
                        </Card>

                        <Card className="sidebar-widget glass">
                            <div className="widget-header">
                                <h3><UserCheck size={16}/> Friends</h3>
                                <button onClick={() => navigate('/friends')} className="widget-link">Manage</button>
                            </div>
                            <div className="widget-content">
                                {friends.length > 0 ? (
                                    <div className="mini-friends">
                                        <p className="mf-count">{friends.length} friend{friends.length > 1 ? 's' : ''} connected</p>
                                        <div className="mf-avatars">
                                            {friends.slice(0, 5).map((f, i) => (
                                                <div className="mf-avatar" key={f.friendshipId || i} title={f.friendName}>
                                                    {f.friendName.charAt(0).toUpperCase()}
                                                </div>
                                            ))}
                                            {friends.length > 5 && <div className="mf-avatar more">+{friends.length - 5}</div>}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="empty-friends">
                                        <p>Learn better together.</p>
                                        <Button variant="outline" className="sf-btn" onClick={() => navigate('/friends')}>Find Friends</Button>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card className="sidebar-nav-card glass">
                            <div className="sidebar-nav">
                                <button className="s-nav-item" onClick={() => navigate('/dashboard')}>
                                    <BarChart3 size={18} className="s-icon"/> Full Analytics
                                </button>
                                <button className="s-nav-item" onClick={() => navigate('/saved')}>
                                    <Folder size={18} className="s-icon"/> Saved Exams
                                </button>
                                <button className="s-nav-item" onClick={() => navigate('/settings')}>
                                    <SettingsIcon size={18} className="s-icon"/> Settings
                                </button>
                            </div>
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    // --- SETUP WIZARD VIEW ---
    return (
        <div className="setup-container animate-fade-in">
            <div className="setup-header">
                <h1>Testara</h1>
                <p>Configure your practice session</p>
            </div>

            <Card className="setup-card glass">
                <div className="steps-indicator">
                    <div className={`step ${step >= 1 ? 'active' : ''}`}>1. Exam</div>
                    <div className="step-line"></div>
                    <div className={`step ${step >= 2 ? 'active' : ''}`}>2. Format</div>
                    <div className="step-line"></div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>3. Data</div>
                </div>

                {step === 1 && (
                    <div className="step-content animate-fade-in">
                        <h2>Select Exam Type</h2>
                        <div className="options-grid">
                            {Object.values(EXAM_TEMPLATES).map(t => (
                                <button
                                    key={t.id}
                                    className={`option-btn ${examType === t.id ? 'selected' : ''}`}
                                    onClick={() => handleExamTypeSelect(t.id)}
                                >
                                    <div className="option-icon"><BookOpen size={32} /></div>
                                    <h3>{t.name}</h3>
                                    <p>{t.optionsPerQuestion} Options | {t.subjects.length} Subjects</p>
                                </button>
                            ))}
                        </div>
                        <div className="step-actions">
                            <Button variant="ghost" onClick={() => setStep(0)}><ChevronLeft size={16} /> Back to Dashboard</Button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="step-content animate-fade-in">
                        <h3 className="wizard-title" style={{ marginBottom: '1.5rem' }}>
                            {currentTemplate?.name || 'Mock Test'} — Choose Format
                        </h3>

                        <div className="format-grid">
                            <button
                                className={`format-card ${testFormat === 'full' ? 'selected' : ''}`}
                                onClick={() => handleFormatSelect('full')}
                            >
                                <Layers size={22} />
                                <span className="format-card-name">Full Mock</span>
                                <span className="format-card-info">{currentTemplate?.subjects.reduce((s, sub) => s + sub.count, 0) || 'All'} Questions, All Subjects</span>
                            </button>
                            <button
                                className={`format-card ${testFormat === 'subject' ? 'selected' : ''}`}
                                onClick={() => handleFormatSelect('subject')}
                            >
                                <Library size={22} />
                                <span className="format-card-name">Subject Wise</span>
                                <span className="format-card-info">Pick one subject</span>
                            </button>
                            <button
                                className={`format-card ${testFormat === 'topic' ? 'selected' : ''}`}
                                onClick={() => handleFormatSelect('topic')}
                            >
                                <Target size={22} />
                                <span className="format-card-name">Topic Wise</span>
                                <span className="format-card-info">Pick a specific topic</span>
                            </button>
                        </div>

                        {(testFormat === 'subject' || testFormat === 'topic') && currentTemplate && (
                            <div className="subject-picker animate-fade-in" style={{ marginTop: '2rem' }}>
                                <label className="picker-label" style={{ display: 'block', marginBottom: '0.6rem' }}>
                                    Select Subject
                                </label>
                                <div className="subject-chips">
                                    {currentTemplate.subjects.map(s => (
                                        <button
                                            key={s.id}
                                            className={`subject-chip ${selectedSubject === s.id ? 'selected' : ''}`}
                                            onClick={() => { setSelectedSubject(s.id); setSelectedTopic(''); }}
                                        >
                                            {s.name} ({s.count}Q)
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {testFormat === 'topic' && currentSubjectObj && currentSubjectObj.topics && (
                            <div className="topic-picker animate-fade-in" style={{ marginTop: '1.5rem' }}>
                                <label className="picker-label" style={{ display: 'block', marginBottom: '0.6rem' }}>
                                    Select Topic
                                </label>
                                <div className="topic-chips">
                                    {currentSubjectObj.topics.map(t => (
                                        <button
                                            key={t}
                                            className={`topic-chip ${selectedTopic === t ? 'selected' : ''}`}
                                            onClick={() => setSelectedTopic(t)}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(testFormat === 'subject' || testFormat === 'topic') && (
                            <div className="form-group animate-fade-in" style={{ marginTop: '1.5rem' }}>
                                <label className="picker-label" style={{ display: 'block', marginBottom: '0.6rem' }}>
                                    Target Questions to Generate
                                </label>
                                <input 
                                    type="number" 
                                    value={topicQuestionCount} 
                                    onChange={e => setTopicQuestionCount(Math.max(1, parseInt(e.target.value) || 1))}
                                    min={1} max={50}
                                    style={{ width: '100px', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'rgba(15,23,42,0.6)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>
                        )}

                        <div className="step-actions">
                            <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft size={16} /> Back</Button>
                            {testFormat !== 'full' && (
                                <Button 
                                    variant="primary" 
                                    onClick={() => setStep(3)}
                                    disabled={!selectedSubject || (testFormat === 'topic' && !selectedTopic)}
                                >
                                    Next: Load Data →
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="step-content animate-fade-in">
                        <h2>Load Test Data</h2>

                        <div className="source-tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                            <button
                                onClick={() => setQuestionSource('ai')}
                                style={{
                                    padding: '0.75rem 1rem', background: 'transparent', border: 'none', color: questionSource === 'ai' ? '#a5b4fc' : 'var(--text-secondary)',
                                    fontWeight: questionSource === 'ai' ? 'bold' : 'normal', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: questionSource === 'ai' ? '2px solid #a5b4fc' : '2px solid transparent'
                                }}
                            >
                                <Sparkles size={16} /> AI Generate
                            </button>
                            <button
                                onClick={() => setQuestionSource('bank')}
                                style={{
                                    padding: '0.75rem 1rem', background: 'transparent', border: 'none', color: questionSource === 'bank' ? '#a5b4fc' : 'var(--text-secondary)',
                                    fontWeight: questionSource === 'bank' ? 'bold' : 'normal', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: questionSource === 'bank' ? '2px solid #a5b4fc' : '2px solid transparent'
                                }}
                            >
                                <Library size={16} /> Question Bank
                            </button>
                            {savedMocks.length > 0 && testFormat === 'full' && (
                                <button
                                    onClick={() => setQuestionSource('mock')}
                                    style={{
                                        padding: '0.75rem 1rem', background: 'transparent', border: 'none', color: questionSource === 'mock' ? '#a5b4fc' : 'var(--text-secondary)',
                                        fontWeight: questionSource === 'mock' ? 'bold' : 'normal', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: questionSource === 'mock' ? '2px solid #a5b4fc' : '2px solid transparent'
                                    }}
                                >
                                    <LayoutTemplate size={16} /> Saved Mock
                                </button>
                            )}
                        </div>

                        {/* --- AI SOURCE --- */}
                        {questionSource === 'ai' && (
                            <div className="source-content animate-fade-in">
                                <h4 className="marking-title" style={{ marginTop: 0 }}><Sparkles size={16} /> 1. Generate via AI Options</h4>
                                <div className="glass" style={{ padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)' }}>
                                    <Button variant="outline" onClick={generatePrompt} style={{ marginBottom: generatedPrompt ? '1rem' : '0' }}>
                                        <Sparkles size={16} /> Create AI Prompt for {testFormat === 'topic' ? selectedTopic : currentSubjectObj?.name || currentTemplate?.name}
                                    </Button>
                                    {generatedPrompt && (
                                        <div className="prompt-display animate-fade-in" style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', position: 'relative' }}>
                                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                                                {generatedPrompt}
                                            </pre>
                                            <button 
                                                onClick={copyPrompt}
                                                style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                                            >
                                                {promptCopied ? <ClipboardCheck size={14} /> : <Copy size={14} />}
                                                {promptCopied ? 'Copied' : 'Copy'}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <h4 className="marking-title"><FileSpreadsheet size={16} /> 2. Paste CSV Output</h4>
                                <div className="csv-paste-section">
                                    <textarea
                                        className="json-textarea"
                                        rows={5}
                                        value={csvInput}
                                        onChange={e => setCsvInput(e.target.value)}
                                        placeholder="question,option_a,option_b,option_c,option_d,correct_option,explanation&#10;What is 2+2?,3,4,5,6,B,2+2 equals 4"
                                    />
                                    <Button variant="primary" onClick={handleCSVParse} disabled={!csvInput.trim()} style={{ marginTop: '0.5rem' }}>
                                        <FileSpreadsheet size={14} /> Parse CSV & Start Test
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* --- SAVED MOCK SOURCE --- */}
                        {questionSource === 'mock' && savedMocks.length > 0 && testFormat === 'full' && (
                            <div className="source-content animate-fade-in">
                                <div className="saved-mocks-section">
                                    <h4 className="marking-title" style={{ marginTop: 0 }}><LayoutTemplate size={16} /> Play Pre-Built Mock Test</h4>
                                    <div className="gen-row">
                                        <select value={selectedMockId} onChange={e => setSelectedMockId(e.target.value)} style={{ padding: '0.5rem', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', flex: 1 }}>
                                            <option value="">-- Select Saved Mock --</option>
                                            {savedMocks.filter(m => m.exam_template_id === examType).map(m => (
                                                <option key={m.id} value={m.id}>{m.name} ({m.question_count} Qs)</option>
                                            ))}
                                        </select>
                                        <Button variant="primary" onClick={startSavedMock} disabled={!selectedMockId}>Launch Saved Mock</Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- QUESTION BANK SOURCE --- */}
                        {questionSource === 'bank' && (
                            <div className="source-content animate-fade-in">
                                <h4 className="marking-title" style={{ marginTop: 0 }}><Library size={16} /> Generate from Question Bank</h4>
                                {bankSubjects.length > 0 ? (
                                    <div className="bank-generate-section">
                                        <div className="gen-row">
                                            <select value={bankSubject} onChange={e => setBankSubject(e.target.value)} style={{ padding: '0.5rem', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', flex: 1 }}>
                                                <option value="all">All Subjects</option>
                                                {bankSubjects.map(s => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                value={bankCount}
                                                onChange={e => setBankCount(Math.max(1, parseInt(e.target.value) || 1))}
                                                min={1}
                                                max={200}
                                                style={{ width: '80px', padding: '0.5rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                            />
                                            <Button variant="primary" onClick={startFromBank} disabled={bankLoading}>
                                                {bankLoading ? <><Loader size={14} className="spin" /> Loading...</> : <><Library size={14} /> Generate</>}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>
                                        No questions in bank for this exam type. <span style={{ cursor: 'pointer', color: '#a5b4fc' }} onClick={() => navigate('/ai-generator')}>Import some →</span>
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="marking-section">
                            <h4 className="marking-title">📝 Override Marking Scheme</h4>
                            <div className="marking-presets">
                                <button className={`marking-btn ${markingPreset === 'ssc' ? 'selected' : ''}`} onClick={() => setMarkingPreset('ssc')}>
                                    +2 / −0.50
                                </button>
                                <button className={`marking-btn ${markingPreset === 'none' ? 'selected' : ''}`} onClick={() => setMarkingPreset('none')}>
                                    +1 / 0
                                </button>
                                <button className={`marking-btn ${markingPreset === 'custom' ? 'selected' : ''}`} onClick={() => setMarkingPreset('custom')}>
                                    ✏️ Custom
                                </button>
                            </div>
                            {markingPreset === 'custom' && (
                                <div className="custom-marks-row">
                                    <label>Correct <input type="number" step="0.25" value={customMarks.correct} onChange={e => setCustomMarks(p => ({ ...p, correct: parseFloat(e.target.value) || 0 }))} /></label>
                                    <label>Wrong <input type="number" step="0.25" value={customMarks.incorrect} onChange={e => setCustomMarks(p => ({ ...p, incorrect: parseFloat(e.target.value) || 0 }))} /></label>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="error-message">
                                <AlertCircle size={16} />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="step-actions">
                            <Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft size={16} /> Back</Button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default Setup;
