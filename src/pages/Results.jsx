import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExam } from '../context/ExamContext';
import { useRoom } from '../context/RoomContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { CheckCircle, XCircle, ChevronLeft, Award, Clock, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Results.css';

const Results = () => {
    const { questions, answers, resetExam, testStarted, timeSpent, isMultiplayer, roomCode, markingScheme } = useExam();
    const room = useRoom();
    const { authFetch } = useAuth();
    const navigate = useNavigate();
    const historySavedRef = useRef(false);

    const ms = markingScheme || { correct: 2, incorrect: -0.5, unattempted: 0 };

    const formatTime = (seconds) => {
        if (!seconds) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        if (!testStarted || questions.length === 0) {
            navigate('/');
        }
    }, [testStarted, questions, navigate]);

    if (!testStarted || questions.length === 0) return null;

    let correct = 0;
    let incorrect = 0;
    let attempted = Object.keys(answers).length;

    Object.keys(answers).forEach((qIndex) => {
        if (answers[qIndex] === questions[qIndex].correctAnswer) {
            correct += 1;
        } else {
            incorrect += 1;
        }
    });

    const unattempted = questions.length - attempted;
    const rawScore = correct; // simple count
    const totalMarks = (correct * ms.correct) + (incorrect * ms.incorrect) + (unattempted * ms.unattempted);
    const maxMarks = questions.length * ms.correct;
    const percentage = ((correct / questions.length) * 100).toFixed(1);
    const hasNegative = ms.incorrect < 0;

    // Save to history once
    useEffect(() => {
        if (historySavedRef.current) return;
        historySavedRef.current = true;

        // Build topic breakdown
        const topicBreakdown = {};
        questions.forEach((q, idx) => {
            const topic = q.subject || 'General';
            if (!topicBreakdown[topic]) topicBreakdown[topic] = { correct: 0, total: 0 };
            topicBreakdown[topic].total += 1;
            if (answers[idx] !== undefined && answers[idx] === q.correctAnswer) {
                topicBreakdown[topic].correct += 1;
            }
        });

        const totalTimeSec = timeSpent.reduce((a, b) => a + (b || 0), 0);

        authFetch('/api/history', {
            method: 'POST',
            body: JSON.stringify({
                examType: questions[0]?.examType || 'ssc',
                testFormat: 'mock',
                score: rawScore,
                total: questions.length,
                correct,
                incorrect,
                unattempted,
                totalMarks,
                maxMarks,
                percentage: parseFloat(percentage),
                totalTime: totalTimeSec,
                markingScheme: ms,
                topicBreakdown,
                isMultiplayer,
            }),
        }).catch(() => { }); // silent fail
    }, []);

    // Time heatmap data
    const allTimes = timeSpent.filter(t => t > 0);
    const avgTime = allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : 0;

    const getHeatColor = (time) => {
        if (!time || time === 0) return 'var(--card-bg)'; // skipped
        const ratio = time / avgTime;
        if (ratio < 0.5) return '#10b981';  // fast - green
        if (ratio < 1.0) return '#34d399';  // normal-fast
        if (ratio < 1.5) return '#fbbf24';  // average - yellow
        if (ratio < 2.5) return '#f97316';  // slow - orange
        return '#ef4444';                    // very slow - red
    };

    const getHeatLabel = (time) => {
        if (!time || time === 0) return 'Skipped';
        const ratio = time / avgTime;
        if (ratio < 0.5) return 'Fast';
        if (ratio < 1.0) return 'Normal';
        if (ratio < 1.5) return 'Average';
        if (ratio < 2.5) return 'Slow';
        return 'Very Slow';
    };

    const handleBackHome = () => {
        if (isMultiplayer) room.leaveRoom();
        resetExam();
        navigate('/');
    };

    return (
        <div className="results-container animate-fade-in">
            <header className="results-header glass">
                <div className="header-content">
                    <Award size={28} className="text-primary" />
                    <h2>Test Results Summary</h2>
                </div>
                <div className="results-header-actions">
                    {isMultiplayer && roomCode && (
                        <Button variant="primary" onClick={() => navigate('/leaderboard')}>
                            <Trophy size={16} /> Leaderboard
                        </Button>
                    )}
                    <Button variant="outline" onClick={handleBackHome}>
                        <ChevronLeft size={16} /> New Test
                    </Button>
                </div>
            </header>

            <main className="results-content">
                <Card className="score-card glass">
                    <div className="score-circle">
                        <div className="score-value">{totalMarks}<span>/{maxMarks}</span></div>
                        <div className="score-percentage">{percentage}%</div>
                        {hasNegative && (
                            <div className="marking-info-badge">
                                +{ms.correct} / {ms.incorrect}
                            </div>
                        )}
                    </div>

                    <div className="score-stats">
                        <div className="stat-box">
                            <span className="stat-label">Correct</span>
                            <span className="stat-value text-success">{correct}</span>
                            {hasNegative && <span className="stat-marks positive">+{(correct * ms.correct).toFixed(1)}</span>}
                        </div>
                        <div className="stat-box">
                            <span className="stat-label">Incorrect</span>
                            <span className="stat-value text-danger">{incorrect}</span>
                            {hasNegative && incorrect > 0 && <span className="stat-marks negative">{(incorrect * ms.incorrect).toFixed(1)}</span>}
                        </div>
                        <div className="stat-box">
                            <span className="stat-label">Skipped</span>
                            <span className="stat-value text-slate-400">{unattempted}</span>
                        </div>
                        <div className="stat-box">
                            <span className="stat-label">Attempted</span>
                            <span className="stat-value text-blue-400">{attempted}</span>
                        </div>
                    </div>
                </Card>

                {/* Difficulty Heatmap */}
                <Card className="heatmap-card glass">
                    <h3 className="heatmap-title">🌡️ Time Difficulty Heatmap</h3>
                    <p className="heatmap-subtitle">Color shows how long you spent relative to average ({formatTime(Math.round(avgTime))})</p>
                    <div className="heatmap-grid">
                        {questions.map((_, idx) => {
                            const time = timeSpent[idx] || 0;
                            const userAnswer = answers[idx];
                            const isCorrect = userAnswer !== undefined && userAnswer === questions[idx].correctAnswer;
                            return (
                                <div
                                    key={idx}
                                    className={`heatmap-cell ${userAnswer === undefined ? 'skipped' : ''}`}
                                    style={{ '--heat-color': getHeatColor(time) }}
                                    title={`Q${idx + 1}: ${formatTime(time)} — ${getHeatLabel(time)}${userAnswer !== undefined ? (isCorrect ? ' ✅' : ' ❌') : ' (skipped)'}`}
                                >
                                    <span className="heatmap-num">{idx + 1}</span>
                                    {userAnswer !== undefined && (
                                        <span className={`heatmap-dot ${isCorrect ? 'correct' : 'wrong'}`}></span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="heatmap-legend">
                        <div className="legend-item"><span className="legend-color" style={{ background: '#10b981' }}></span> Fast</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#34d399' }}></span> Normal</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#fbbf24' }}></span> Average</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#f97316' }}></span> Slow</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> V. Slow</div>
                    </div>
                </Card>

                <div className="detailed-review">
                    <h3 className="review-title">Detailed Validations & Explanations</h3>

                    {questions.map((q, idx) => {
                        const userAnswer = answers[idx];
                        const isCorrect = userAnswer === q.correctAnswer;
                        const isAttempted = userAnswer !== undefined;

                        return (
                            <Card key={idx} className={`review-card ${isAttempted ? (isCorrect ? 'correct-border' : 'incorrect-border') : 'skipped-border'}`}>
                                <div className="review-q-header">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <span className="q-number">Question {idx + 1}</span>
                                        <span className="q-time text-slate-400" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}>
                                            <Clock size={14} /> {formatTime(timeSpent?.[idx] || 0)}
                                        </span>
                                        {isAttempted && (
                                            <span className={`marks-pill ${isCorrect ? 'positive' : 'negative'}`}>
                                                {isCorrect ? `+${ms.correct}` : ms.incorrect}
                                            </span>
                                        )}
                                    </div>
                                    <div className="q-status">
                                        {!isAttempted && <span className="status-badge skipped">Skipped</span>}
                                        {isAttempted && isCorrect && <span className="status-badge correct"><CheckCircle size={14} /> Correct</span>}
                                        {isAttempted && !isCorrect && <span className="status-badge incorrect"><XCircle size={14} /> Incorrect</span>}
                                    </div>
                                </div>
                                <h4 className="review-q-text">{q.text}</h4>

                                <div className="review-options">
                                    {q.options.map((opt, optIdx) => {
                                        let optClass = "review-opt ";
                                        if (optIdx === q.correctAnswer) optClass += "is-correct";
                                        else if (userAnswer === optIdx) optClass += "is-wrong";

                                        return (
                                            <div key={optIdx} className={optClass}>
                                                <span className="opt-letter">{String.fromCharCode(65 + optIdx)}</span>
                                                <span className="opt-text">{opt}</span>
                                                {optIdx === q.correctAnswer && <CheckCircle className="opt-icon success" size={16} />}
                                                {userAnswer === optIdx && !isCorrect && <XCircle className="opt-icon danger" size={16} />}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="explanation-box">
                                    <h5>Explanation</h5>
                                    <p>{q.explanation}</p>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </main>
        </div>
    );
};

export default Results;
