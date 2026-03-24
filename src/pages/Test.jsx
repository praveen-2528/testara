import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExam } from '../context/ExamContext';
import { useRoom } from '../context/RoomContext';
import { saveExam } from '../utils/storage';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Clock, ChevronLeft, ChevronRight, CheckCircle, XCircle, List, Play, Pause, SaveAll, Bookmark, Save, Users, Pencil, Eye, EyeOff } from 'lucide-react';
import FriendlyChat from '../components/FriendlyChat';
import WritingPad from '../components/WritingPad';
import VoiceChat from '../components/VoiceChat';
import './Test.css';

const Test = () => {
    const { examType, testFormat, questions, testStarted, currentQuestionIndex, updateExamState, answers, markedForReview, timeSpent, timeLeft: savedTimeLeft, isMultiplayer, roomCode, _saveId } = useExam();
    const room = useRoom();
    const navigate = useNavigate();
    const [timeLeft, setTimeLeft] = useState(() => {
        if (savedTimeLeft) return savedTimeLeft;
        return examType === 'ssc' ? 60 * 60 : 120 * 60;
    });
    const [showPalette, setShowPalette] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [saveToast, setSaveToast] = useState(false);
    const [showPad, setShowPad] = useState(false);
    const [padShared, setPadShared] = useState(false); // host-controlled privacy toggle
    const autoSaveRef = useRef(null);

    // Friendly mode states
    const isFriendly = isMultiplayer && room.roomMode === 'friendly';
    const isExamMode = isMultiplayer && room.roomMode === 'exam';
    const [friendlyAnswered, setFriendlyAnswered] = useState(false); // did I answer?
    const [friendlyWaiting, setFriendlyWaiting] = useState(false);  // waiting for others
    const [friendlyRevealed, setFriendlyRevealed] = useState(false); // answer revealed
    const [friendlyRevealData, setFriendlyRevealData] = useState(null); // { correctAnswer, playerChoices }
    const [friendlyAnswerStatus, setFriendlyAnswerStatus] = useState({ answeredCount: 0, totalParticipants: 0, answeredPlayers: [] });

    useEffect(() => {
        if (!testStarted || questions.length === 0) {
            navigate('/');
        }
    }, [testStarted, questions, navigate]);

    // Main timer (only for exam mode or solo)
    useEffect(() => {
        let timer;
        if (!isPaused && testStarted && questions.length > 0 && !isFriendly) {
            timer = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        handleSubmit(true);
                        return 0;
                    }
                    return prev - 1;
                });

                updateExamState({
                    timeSpent: Object.assign([], timeSpent, {
                        [currentQuestionIndex]: (timeSpent[currentQuestionIndex] || 0) + 1
                    })
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [isPaused, testStarted, questions, currentQuestionIndex, timeSpent, updateExamState, isFriendly]);

    // Auto-save every 60 seconds (solo mode only)
    useEffect(() => {
        if (isMultiplayer || !testStarted) return;

        autoSaveRef.current = setInterval(() => {
            saveExam({
                examType, testFormat, questions, answers, markedForReview,
                timeSpent, currentQuestionIndex, timeLeft, _saveId,
            });
        }, 60000);

        return () => clearInterval(autoSaveRef.current);
    }, [isMultiplayer, testStarted, examType, testFormat, questions, answers, markedForReview, timeSpent, currentQuestionIndex, timeLeft, _saveId]);

    // ── Friendly Mode Socket Listeners ──────────────────────────────────
    useEffect(() => {
        if (!isFriendly || !room.socket) return;

        const onAnswerStatus = (data) => {
            setFriendlyAnswerStatus(data);
        };

        const onReveal = (data) => {
            setFriendlyRevealed(true);
            setFriendlyWaiting(false);
            setFriendlyRevealData(data);
        };

        const onNextQuestion = ({ questionIndex }) => {
            // Reset friendly state for new question
            setFriendlyAnswered(false);
            setFriendlyWaiting(false);
            setFriendlyRevealed(false);
            setFriendlyRevealData(null);
            setFriendlyAnswerStatus({ answeredCount: 0, totalParticipants: 0, answeredPlayers: [] });
            updateExamState({ currentQuestionIndex: questionIndex });
        };

        const onForceSubmit = () => {
            handleSubmit(true);
        };

        room.socket.on('friendlyAnswerStatus', onAnswerStatus);
        room.socket.on('friendlyReveal', onReveal);
        room.socket.on('friendlyNextQuestion', onNextQuestion);
        room.socket.on('friendlyForceSubmit', onForceSubmit);

        // Pad privacy toggle from host
        const onPadPrivacy = ({ shared }) => setPadShared(shared);
        room.socket.on('padPrivacy', onPadPrivacy);

        return () => {
            room.socket.off('friendlyAnswerStatus', onAnswerStatus);
            room.socket.off('friendlyReveal', onReveal);
            room.socket.off('friendlyNextQuestion', onNextQuestion);
            room.socket.off('friendlyForceSubmit', onForceSubmit);
            room.socket.off('padPrivacy', onPadPrivacy);
        };
    }, [isFriendly, room.socket, updateExamState]);

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const currentQuestion = questions[currentQuestionIndex];

    const handleOptionSelect = (optionIndex) => {
        // In friendly mode: once answered and waiting, can't change
        if (isFriendly && friendlyAnswered) return;

        const newAnswers = { ...answers, [currentQuestionIndex]: optionIndex };
        updateExamState({ answers: newAnswers });

        // In friendly mode: send answer to server and wait
        if (isFriendly) {
            setFriendlyAnswered(true);
            setFriendlyWaiting(true);
            room.socket?.emit('friendlyAnswer', {
                code: roomCode,
                questionIndex: currentQuestionIndex,
                optionIndex,
            }, () => { });
        }
    };

    const handleNext = () => {
        if (currentQuestionIndex < questions.length - 1) {
            if (isFriendly) {
                // Only host can advance, and only after reveal
                if (room.isHost && friendlyRevealed) {
                    room.socket?.emit('friendlyNext', { code: roomCode }, () => { });
                }
                return;
            }
            const nextIdx = currentQuestionIndex + 1;
            updateExamState({ currentQuestionIndex: nextIdx });
        }
    };

    const handleReviewAndNext = () => {
        if (isFriendly) return; // No mark-for-review in friendly mode
        const newReview = new Set(markedForReview || []);
        if (newReview.has(currentQuestionIndex)) {
            newReview.delete(currentQuestionIndex);
        } else {
            newReview.add(currentQuestionIndex);
        }
        updateExamState({ markedForReview: Array.from(newReview) });
        handleNext();
    };

    const handlePrev = () => {
        if (isFriendly) return; // No going back in friendly mode
        if (currentQuestionIndex > 0) {
            const prevIdx = currentQuestionIndex - 1;
            updateExamState({ currentQuestionIndex: prevIdx });
        }
    };

    const jumpToQuestion = (index) => {
        if (isFriendly) return; // No jumping in friendly mode
        updateExamState({ currentQuestionIndex: index });
        if (window.innerWidth < 768) {
            setShowPalette(false);
        }
    };

    const handlePartialSubmit = () => {
        let score = 0;
        let attempted = Object.keys(answers).length;
        Object.keys(answers).forEach((qIndex) => {
            if (answers[qIndex] === questions[qIndex].correctAnswer) {
                score += 1;
            }
        });
        alert(`Mid-way Progress check:\n\nYou have answered ${attempted} out of ${questions.length} questions.\nYour current score is ${score}/${questions.length}.\n\nYou can keep going!`);
    };

    const handleSaveAndExit = () => {
        const id = saveExam({
            examType, testFormat, questions, answers, markedForReview,
            timeSpent, currentQuestionIndex, timeLeft, _saveId,
        });
        updateExamState({ _saveId: id });
        setSaveToast(true);
        setTimeout(() => {
            navigate('/');
        }, 1000);
    };

    const handleSubmit = (autoSubmit = false) => {
        let score = 0;
        let correct = 0;
        let incorrect = 0;
        Object.keys(answers).forEach((qIndex) => {
            if (answers[qIndex] === questions[qIndex].correctAnswer) {
                score += 1;
                correct += 1;
            } else {
                incorrect += 1;
            }
        });

        const doSubmit = () => {
            updateExamState({ timeLeft });

            if (isMultiplayer && roomCode) {
                room.submitResults({
                    answers,
                    timeSpent,
                    score,
                    total: questions.length,
                    correct,
                    incorrect,
                }).catch(() => { });
            }
            navigate('/results');
        };

        if (autoSubmit) {
            doSubmit();
        } else if (window.confirm("Are you sure you want to completely finish and submit the test?")) {
            doSubmit();
        }
    };

    if (!testStarted || !currentQuestion) return null;

    // Determine option class in friendly reveal mode
    const getOptionClass = (optIdx) => {
        let cls = 'option-item';

        if (isFriendly && friendlyRevealed && friendlyRevealData) {
            if (optIdx === friendlyRevealData.correctAnswer) {
                cls += ' revealed-correct';
            } else if (answers[currentQuestionIndex] === optIdx) {
                cls += ' revealed-wrong';
            }
        } else if (answers[currentQuestionIndex] === optIdx) {
            cls += ' selected';
        }

        if (isFriendly && friendlyAnswered && !friendlyRevealed) {
            cls += ' locked';
        }

        return cls;
    };

    const isLastQuestion = currentQuestionIndex === questions.length - 1;

    return (
        <div className="test-layout">
            {/* Save Toast */}
            {saveToast && (
                <div className="save-toast animate-fade-in">
                    <CheckCircle size={18} /> Progress saved! Redirecting...
                </div>
            )}

            {/* Top Header */}
            <header className="test-header glass">
                <div className="exam-info">
                    <h2>{examType.toUpperCase()} Mock Test</h2>
                    <span className="format-badge">{testFormat.replace('-', ' ')}</span>
                    {isFriendly && <span className="format-badge friendly-badge">🎉 Friendly</span>}
                    {isExamMode && <span className="format-badge multiplayer-badge">📝 Exam</span>}
                    {isMultiplayer && <span className="format-badge multiplayer-badge">🏠 {roomCode}</span>}
                </div>

                <div className="header-controls">
                    {!isFriendly && (
                        <button
                            className="btn btn-ghost btn-sm pause-btn"
                            onClick={() => setIsPaused(!isPaused)}
                            title={isPaused ? "Resume Test" : "Pause Test"}
                        >
                            {isPaused ? <Play size={20} /> : <Pause size={20} />}
                        </button>
                    )}

                    {!isFriendly && (
                        <div className={`timer-container ${!isPaused && timeLeft < 300 ? 'animate-pulse text-danger' : ''}`}>
                            <Clock size={20} className="timer-icon" />
                            <span className="time-left">{formatTime(timeLeft)}</span>
                        </div>
                    )}

                    {isFriendly && (
                        <div className="friendly-progress-badge">
                            <Users size={16} />
                            <span>Q{currentQuestionIndex + 1}/{questions.length}</span>
                        </div>
                    )}

                    {isFriendly && room.socket && (
                        <VoiceChat
                            socket={room.socket}
                            roomCode={roomCode}
                            playerName={room.playerName}
                            participants={room.participants}
                        />
                    )}

                    <button
                        className={`pad-toggle-btn ${showPad ? 'active' : ''}`}
                        onClick={() => setShowPad(!showPad)}
                        title={showPad ? 'Hide Scratchpad' : 'Open Scratchpad'}
                    >
                        <Pencil size={16} /> {showPad ? 'Hide Pad' : 'Scratch Pad'}
                    </button>

                    {/* Privacy toggle — host only, multiplayer only */}
                    {isMultiplayer && room.isHost && showPad && (
                        <button
                            className={`pad-toggle-btn ${padShared ? 'active' : ''}`}
                            onClick={() => {
                                const next = !padShared;
                                setPadShared(next);
                                room.socket?.emit('padPrivacy', { code: roomCode, shared: next });
                            }}
                            title={padShared ? 'Make Pad Private' : 'Share Pad With Room'}
                        >
                            {padShared ? <Eye size={16} /> : <EyeOff size={16} />}
                            {padShared ? 'Shared' : 'Private'}
                        </button>
                    )}

                    {/* Non-host indicator */}
                    {isMultiplayer && !room.isHost && showPad && padShared && (
                        <span className="pad-toggle-btn active" style={{ cursor: 'default' }}>
                            <Eye size={16} /> Shared
                        </span>
                    )}

                    <button
                        className="mobile-palette-toggle btn btn-ghost btn-sm"
                        onClick={() => setShowPalette(!showPalette)}
                    >
                        <List size={20} />
                    </button>
                </div>
            </header>

            <div className={`test-content ${isPaused ? 'paused' : ''}`}>
                {/* Blur Overlay when Paused */}
                {isPaused && (
                    <div className="pause-overlay">
                        <div className="pause-modal glass">
                            <Pause size={48} className="pause-icon" />
                            <h2>Test Paused</h2>
                            <p>Your timer is stopped and the screen is hidden.</p>
                            <Button variant="primary" onClick={() => setIsPaused(false)}>Resume Test</Button>
                        </div>
                    </div>
                )}

                {/* Main Question Area */}
                <main className="question-area">
                    <Card className="question-card animate-fade-in" key={currentQuestionIndex}>
                        <div className="question-meta">
                            <span className="q-number">Question {currentQuestionIndex + 1} of {questions.length}</span>
                            {!isFriendly && (
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <span className="q-tag" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <Clock size={14} /> {formatTime(timeSpent[currentQuestionIndex] || 0)}
                                    </span>
                                    {currentQuestion.subject && <span className="q-tag">{currentQuestion.subject}</span>}
                                </div>
                            )}
                            {isFriendly && currentQuestion.subject && (
                                <span className="q-tag">{currentQuestion.subject}</span>
                            )}
                        </div>

                        <h3 className="question-text">{currentQuestion.text}</h3>

                        <div className="options-list">
                            {currentQuestion.options.map((option, idx) => (
                                <button
                                    key={idx}
                                    className={getOptionClass(idx)}
                                    onClick={() => handleOptionSelect(idx)}
                                    disabled={isFriendly && (friendlyAnswered || friendlyRevealed)}
                                >
                                    <div className="option-marker">
                                        {String.fromCharCode(65 + idx)}
                                    </div>
                                    <div className="option-content">{option}</div>
                                    {/* Normal selected check */}
                                    {!friendlyRevealed && answers[currentQuestionIndex] === idx && (
                                        <CheckCircle className="option-check" size={20} />
                                    )}
                                    {/* Friendly reveal: correct */}
                                    {friendlyRevealed && idx === friendlyRevealData?.correctAnswer && (
                                        <CheckCircle className="option-check success-icon" size={20} />
                                    )}
                                    {/* Friendly reveal: my wrong pick */}
                                    {friendlyRevealed && answers[currentQuestionIndex] === idx && idx !== friendlyRevealData?.correctAnswer && (
                                        <XCircle className="option-check danger-icon" size={20} />
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Friendly Mode: Waiting / Reveal Section */}
                        {isFriendly && (
                            <div className="friendly-section">
                                {friendlyWaiting && !friendlyRevealed && (
                                    <div className="friendly-waiting glass">
                                        <div className="waiting-spinner"></div>
                                        <p>Waiting for others... ({friendlyAnswerStatus.answeredCount}/{friendlyAnswerStatus.totalParticipants})</p>
                                        <div className="answered-avatars">
                                            {friendlyAnswerStatus.answeredPlayers?.map((name, i) => (
                                                <span key={i} className="avatar-chip">✅ {name}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!friendlyAnswered && !friendlyRevealed && (
                                    <div className="friendly-prompt">
                                        <p>👆 Pick an answer — everyone is answering at the same time!</p>
                                    </div>
                                )}

                                {friendlyRevealed && friendlyRevealData && (
                                    <div className="friendly-reveal-card glass animate-fade-in">
                                        <h4>📊 Everyone's Answers</h4>
                                        <div className="reveal-players">
                                            {Object.entries(friendlyRevealData.playerChoices).map(([name, data]) => (
                                                <div key={name} className={`reveal-player ${data.isCorrect ? 'correct' : 'incorrect'}`}>
                                                    <span className="reveal-icon">{data.isCorrect ? '✅' : '❌'}</span>
                                                    <span className="reveal-name">{name}</span>
                                                    <span className="reveal-choice">picked {String.fromCharCode(65 + data.choice)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="reveal-explanation">
                                            <strong>Explanation:</strong> {currentQuestion.explanation}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="test-actions">
                            {!isFriendly && (
                                <Button
                                    variant="outline"
                                    onClick={handlePrev}
                                    disabled={currentQuestionIndex === 0}
                                >
                                    <ChevronLeft size={20} /> Previous
                                </Button>
                            )}

                            {!isFriendly && (
                                <Button
                                    variant={markedForReview?.includes(currentQuestionIndex) ? 'solid' : 'outline'}
                                    onClick={handleReviewAndNext}
                                    className={markedForReview?.includes(currentQuestionIndex) ? 'bg-amber-600' : ''}
                                >
                                    <Bookmark size={20} /> {markedForReview?.includes(currentQuestionIndex) ? 'Unmark' : 'Mark Review'}
                                </Button>
                            )}

                            <div className="right-actions">
                                {isFriendly ? (
                                    <>
                                        {isLastQuestion && friendlyRevealed ? (
                                            <Button variant="primary" onClick={() => handleSubmit()}>
                                                Finish & See Results
                                            </Button>
                                        ) : (
                                            room.isHost && friendlyRevealed && (
                                                <Button variant="primary" onClick={handleNext}>
                                                    Next Question <ChevronRight size={20} />
                                                </Button>
                                            )
                                        )}
                                        {!room.isHost && friendlyRevealed && !isLastQuestion && (
                                            <span className="waiting-host-text">Waiting for host to advance...</span>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {isLastQuestion ? (
                                            <Button variant="primary" onClick={() => handleSubmit()}>
                                                Submit Test
                                            </Button>
                                        ) : (
                                            <Button variant="primary" onClick={handleNext}>
                                                Next <ChevronRight size={20} />
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Writing Pad */}
                    {showPad && (
                        <div className="writing-pad-panel">
                            <WritingPad
                                questionIndex={currentQuestionIndex}
                                isShared={isMultiplayer && padShared && (isFriendly ? friendlyRevealed : true)}
                                socket={room.socket}
                                roomCode={roomCode}
                                playerColor={isFriendly ? '#a5b4fc' : undefined}
                                playerName={room.playerName || 'local'}
                                onClose={() => setShowPad(false)}
                            />
                        </div>
                    )}
                </main>

                {/* Sidebar / Question Palette */}
                <aside className={`palette-sidebar glass ${showPalette ? 'show' : ''}`}>
                    <div className="palette-header">
                        <h3>Question Palette</h3>
                        <div className="palette-stats">
                            <div className="stat">
                                <span className="dot answered"></span> {Object.keys(answers).length} Answered
                            </div>
                            <div className="stat">
                                <span className="dot unattempted"></span> {questions.length - Object.keys(answers).length} Unattempted
                            </div>
                        </div>
                        {!isFriendly && (
                            <div className="palette-stats" style={{ marginTop: '0.5rem' }}>
                                <div className="stat">
                                    <span className="dot" style={{ backgroundColor: '#f59e0b' }}></span> {markedForReview?.length || 0} Review
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="palette-grid">
                        {questions.map((_, idx) => (
                            <button
                                key={idx}
                                className={`palette-btn 
                  ${currentQuestionIndex === idx ? 'current' : ''} 
                  ${answers[idx] !== undefined ? 'answered' : ''}
                  ${markedForReview?.includes(idx) ? 'review' : ''}
                `}
                                onClick={() => jumpToQuestion(idx)}
                                disabled={isFriendly}
                            >
                                {idx + 1}
                            </button>
                        ))}
                    </div>

                    <div className="palette-footer">
                        {!isMultiplayer && (
                            <Button variant="outline" className="w-full save-exit-btn" onClick={handleSaveAndExit}>
                                <Save size={16} style={{ marginRight: '0.5rem' }} /> Save & Exit
                            </Button>
                        )}
                        {!isFriendly && (
                            <Button variant="outline" className="w-full partial-submit-btn" onClick={handlePartialSubmit} style={{ marginTop: '0.75rem' }}>
                                <SaveAll size={16} style={{ marginRight: '0.5rem' }} /> Progress Check
                            </Button>
                        )}
                        {isFriendly && room.isHost ? (
                            <Button variant="primary" className="w-full finish-all-btn" onClick={() => {
                                if (window.confirm('This will submit the exam for ALL participants. Continue?')) {
                                    room.socket?.emit('friendlyFinish', { code: roomCode }, () => { });
                                }
                            }} style={{ marginTop: '0.75rem' }}>
                                🚨 Finish Exam for All
                            </Button>
                        ) : (
                            <Button variant="primary" className="w-full" onClick={() => handleSubmit()} style={{ marginTop: '0.75rem' }}>
                                {isFriendly ? 'Finish Test' : 'Submit Final Test'}
                            </Button>
                        )}
                    </div>
                </aside>

                {/* Multiplayer Player Answer Status Sidebar Panel */}
                {isMultiplayer && (
                    <aside className="mp-player-panel glass">
                        <div className="mp-panel-header">
                            <h4><Users size={16} /> Players — Q{currentQuestionIndex + 1}</h4>
                        </div>
                        <div className="mp-player-list">
                            {isFriendly && room.participants?.map((p, idx) => {
                                const hasAnswered = friendlyAnswerStatus.answeredPlayers?.includes(p.name);
                                const revealData = friendlyRevealed && friendlyRevealData?.playerChoices?.[p.name];
                                return (
                                    <div key={idx} className={`mp-player-row ${revealData ? (revealData.isCorrect ? 'correct' : 'incorrect') : ''}`}>
                                        <span className="mp-player-name">{p.isHost ? '👑 ' : ''}{p.name}</span>
                                        <span className="mp-player-status">
                                            {revealData ?
                                                <>{revealData.isCorrect ? '✅' : '❌'} {String.fromCharCode(65 + revealData.choice)}</>
                                                : hasAnswered ? <span className="answered-dot">✅</span> : <span className="waiting-dot">⏳</span>
                                            }
                                        </span>
                                    </div>
                                );
                            })}
                            {isExamMode && room.participants?.map((p, idx) => (
                                <div key={idx} className="mp-player-row">
                                    <span className="mp-player-name">{p.isHost ? '👑 ' : ''}{p.name}</span>
                                </div>
                            ))}
                        </div>
                    </aside>
                )}
            </div>

            {/* Friendly Chat */}
            {isFriendly && room.socket && (
                <FriendlyChat socket={room.socket} roomCode={roomCode} displayName={room.playerName} />
            )}
        </div>
    );
};

export default Test;
