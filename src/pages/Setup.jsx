import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExam } from '../context/ExamContext';
import { useAuth } from '../context/AuthContext';
import { EXAM_TEMPLATES } from '../utils/examTemplates';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { BookOpen, Upload, FileJson, AlertCircle, Users, Folder, BarChart3, LogOut, Settings as SettingsIcon, Trophy, Library, LayoutTemplate, Sparkles, Loader } from 'lucide-react';
import './Setup.css';

const Setup = () => {
    const { examType, testFormat, updateExamState } = useExam();
    const { user, logout, authFetch } = useAuth();
    const navigate = useNavigate();

    const [step, setStep] = useState(1);
    const [jsonInput, setJsonInput] = useState('');
    const [error, setError] = useState('');

    // Mocks state
    const [savedMocks, setSavedMocks] = useState([]);
    const [selectedMockId, setSelectedMockId] = useState('');

    const [markingPreset, setMarkingPreset] = useState('ssc'); // 'ssc', 'none', 'custom'
    const [customMarks, setCustomMarks] = useState({ correct: 2, incorrect: -0.5, unattempted: 0 });

    // Question Bank generation
    const [bankSubject, setBankSubject] = useState('all');
    const [bankCount, setBankCount] = useState(25);
    const [bankSubjects, setBankSubjects] = useState([]);
    const [bankLoading, setBankLoading] = useState(false);

    const markingPresets = {
        ssc: { correct: 2, incorrect: -0.5, unattempted: 0, label: 'SSC Standard (+2 / -0.50)' },
        none: { correct: 1, incorrect: 0, unattempted: 0, label: 'No Negative (+1 / 0)' },
    };

    useEffect(() => {
        if (user) {
            authFetch('/api/mocks')
                .then(r => r.json())
                .then(data => setSavedMocks(data.mocks || []))
                .catch(err => console.error("Failed to fetch mocks", err));
        }
    }, [user, authFetch]);

    // Fetch bank subjects when exam type changes
    useEffect(() => {
        if (user && examType) {
            authFetch(`/api/questions?limit=1&exam_type=${examType}`)
                .then(r => r.json())
                .then(data => setBankSubjects(data.subjects || []))
                .catch(() => { });
        }
    }, [user, examType, authFetch]);

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
        setStep(3);
    };

    const startSavedMock = async () => {
        if (!selectedMockId) return setError('Please select a saved mock test.');
        try {
            const res = await authFetch(`/api/mocks/${selectedMockId}/start`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Inherit marking scheme from template if it applies
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

    const validateAndStart = () => {
        setError('');
        let parsedData;

        try {
            parsedData = JSON.parse(jsonInput);

            let questionsArray = Array.isArray(parsedData) ? parsedData : null;
            if (!questionsArray && typeof parsedData === 'object' && parsedData !== null) {
                if (Array.isArray(parsedData.questions)) {
                    questionsArray = parsedData.questions;
                } else if (Array.isArray(parsedData.data)) {
                    questionsArray = parsedData.data;
                } else {
                    questionsArray = Object.values(parsedData).find(val => Array.isArray(val));
                }
            }

            if (!questionsArray || !Array.isArray(questionsArray)) {
                throw new Error("Data must be an array of questions, or an object containing an array.");
            }

            // Determine expected options length from template if possible, otherwise old logic
            const template = EXAM_TEMPLATES[examType];
            const expectedOptionsLength = template ? template.optionsPerQuestion : (examType === 'ssc' ? 4 : 5);

            const formattedData = questionsArray.map((q, i) => {
                if (!q.question && !q.text) {
                    throw new Error(`Question ${i + 1} is missing the 'question' or 'text' property.`);
                }

                let optionsArray = [];
                let optionKeys = [];

                if (Array.isArray(q.options)) {
                    optionsArray = q.options;
                } else if (typeof q.options === 'object' && q.options !== null) {
                    optionKeys = Object.keys(q.options).sort();
                    optionsArray = optionKeys.map(k => q.options[k]);
                } else {
                    throw new Error(`Question ${i + 1} has an invalid 'options' format.`);
                }

                if (optionsArray.length !== expectedOptionsLength) {
                    throw new Error(`Question ${i + 1} has ${optionsArray.length} options, but the selected exam type requires ${expectedOptionsLength}.`);
                }

                let correctIndex = -1;
                if (q.correct_index !== undefined) {
                    correctIndex = q.correct_index;
                } else if (q.correctAnswer !== undefined) {
                    correctIndex = q.correctAnswer;
                } else if (q.correct_option !== undefined && optionKeys.length > 0) {
                    correctIndex = optionKeys.indexOf(q.correct_option);
                }

                if (correctIndex < 0 || correctIndex >= expectedOptionsLength) {
                    throw new Error(`Question ${i + 1} has an invalid or missing correct answer.`);
                }

                return {
                    id: q.id || i,
                    text: q.question || q.text,
                    options: optionsArray,
                    correctAnswer: correctIndex,
                    subject: q.subject || q.subtopic || q.difficulty || 'General',
                    explanation: q.explanation || "No explanation provided for this question."
                };
            });

            // Fisher-Yates Shuffle
            for (let i = formattedData.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [formattedData[i], formattedData[j]] = [formattedData[j], formattedData[i]];
            }

            updateExamState({ questions: formattedData, testStarted: true, markingScheme: getActiveScheme() });
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
            if (!data.questions || data.questions.length === 0) throw new Error('No questions found. Import questions first.');
            updateExamState({ questions: data.questions, testStarted: true, markingScheme: getActiveScheme() });
            navigate('/test');
        } catch (err) { setError(err.message); }
        setBankLoading(false);
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => setJsonInput(e.target.result);
            reader.readAsText(file);
        }
    };

    return (
        <div className="setup-container animate-fade-in">
            {/* User Bar */}
            <div className="user-bar">
                <span className="user-greeting">👋 {user?.name || 'Guest'}</span>
                <div className="user-actions">
                    <button className="settings-btn" onClick={() => navigate('/settings')} title="Settings"><SettingsIcon size={14} /> Settings</button>
                    <button className="logout-btn" onClick={logout}><LogOut size={14} /> Logout</button>
                </div>
            </div>

            <div className="setup-header">
                <h1>Mockify</h1>
                <p>Configure your practice session</p>
            </div>

            <Card className="setup-card">
                <div className="steps-indicator">
                    <div className={`step ${step >= 1 ? 'active' : ''}`}>1. Exam</div>
                    <div className="step-line"></div>
                    <div className={`step ${step >= 2 ? 'active' : ''}`}>2. Format</div>
                    <div className="step-line"></div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>3. Data</div>
                </div>

                {/* Step 1: Exam Type */}
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
                    </div>
                )}

                {/* Step 2: Test Format */}
                {step === 2 && (
                    <div className="step-content animate-fade-in">
                        <h2>Select Test Format</h2>
                        <div className="options-grid format-grid">
                            <button onClick={() => handleFormatSelect('full')} className="option-btn">
                                <h3>Full Mock</h3>
                            </button>
                            <button onClick={() => handleFormatSelect('subject')} className="option-btn">
                                <h3>Subject Wise</h3>
                            </button>
                            <button onClick={() => handleFormatSelect('topic')} className="option-btn">
                                <h3>Topic Wise</h3>
                            </button>
                        </div>
                        <div className="step-actions">
                            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                        </div>
                    </div>
                )}

                {/* Step 3: Data Upload */}
                {step === 3 && (
                    <div className="step-content animate-fade-in">
                        <h2>Load Test Data</h2>

                        {/* Play Saved Mock Section */}
                        {savedMocks.length > 0 && testFormat === 'full' && (
                            <div className="saved-mocks-section">
                                <h4 className="marking-title"><LayoutTemplate size={16} /> Play Pre-Built Mock Test</h4>
                                <div className="gen-row">
                                    <select value={selectedMockId} onChange={e => setSelectedMockId(e.target.value)}>
                                        <option value="">-- Select Saved Mock --</option>
                                        {savedMocks.filter(m => m.exam_template_id === examType).map(m => (
                                            <option key={m.id} value={m.id}>{m.name} ({m.question_count} Qs)</option>
                                        ))}
                                    </select>
                                    <Button variant="primary" onClick={startSavedMock} disabled={!selectedMockId}>Launch Saved Mock</Button>
                                </div>
                                <div className="divider"><span>OR CUSTOM UPLOAD</span></div>
                            </div>
                        )}

                        <div className="data-input-area">
                            <div className="upload-section">
                                <input type="file" id="json-upload" accept=".json" style={{ display: 'none' }} onChange={handleFileUpload} />
                                <label htmlFor="json-upload" className="upload-label">
                                    <Upload size={24} />
                                    <span>Upload questions.json</span>
                                </label>
                            </div>
                            <div className="divider"><span>OR</span></div>
                            <div className="paste-section">
                                <div className="paste-header">
                                    <FileJson size={18} />
                                    <span>Paste JSON Data</span>
                                </div>
                                <textarea
                                    className="json-textarea"
                                    value={jsonInput}
                                    onChange={(e) => setJsonInput(e.target.value)}
                                    placeholder="[{&#34;text&#34;: &#34;Question?&#34;, &#34;options&#34;: [...], &#34;correctAnswer&#34;: 0}]"
                                ></textarea>
                            </div>
                        </div>

                        {/* Generate from Question Bank */}
                        <div className="divider"><span>OR FROM QUESTION BANK</span></div>
                        {bankSubjects.length > 0 ? (
                            <div className="bank-generate-section">
                                <div className="gen-row">
                                    <select value={bankSubject} onChange={e => setBankSubject(e.target.value)}>
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
                                        style={{ maxWidth: '80px' }}
                                    />
                                    <Button variant="primary" onClick={startFromBank} disabled={bankLoading}>
                                        {bankLoading ? <><Loader size={14} className="spin" /> Loading...</> : <><Library size={14} /> Generate from Bank</>}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>
                                No questions in bank for this exam type. <span style={{ cursor: 'pointer', color: '#a5b4fc' }} onClick={() => navigate('/ai-generator')}>Import some →</span>
                            </p>
                        )}

                        {/* Marking Scheme Picker */}
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

                        <div className="step-actions split">
                            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                            <Button variant="primary" onClick={validateAndStart} disabled={!jsonInput.trim()}>
                                Start Custom Test
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            <div className="setup-secondary-actions">
                <button className="secondary-action-btn primary-tint" onClick={() => navigate('/mock-builder')}>
                    <LayoutTemplate size={20} />
                    <span>Mock Builder</span>
                </button>
                <button className="secondary-action-btn" onClick={() => navigate('/question-bank')}>
                    <Library size={20} />
                    <span>Question Bank</span>
                </button>
                <button className="secondary-action-btn" onClick={() => navigate('/global-leaderboard')}>
                    <Trophy size={20} />
                    <span>Leaderboard</span>
                </button>
                <button className="secondary-action-btn" onClick={() => navigate('/dashboard')}>
                    <BarChart3 size={20} />
                    <span>Dashboard</span>
                </button>
                <button className="secondary-action-btn" onClick={() => navigate('/lobby')}>
                    <Users size={20} />
                    <span>Multiplayer</span>
                </button>
                <button className="secondary-action-btn" onClick={() => navigate('/saved')}>
                    <Folder size={20} />
                    <span>Saved Exams</span>
                </button>
                <button className="secondary-action-btn ai-tint" onClick={() => navigate('/ai-generator')}>
                    <Sparkles size={20} />
                    <span>AI Generate</span>
                </button>
            </div>
        </div>
    );
};

export default Setup;
