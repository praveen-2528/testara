import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, ChevronDown } from 'lucide-react';
import './FriendlyChat.css';

const FriendlyChat = ({ socket, roomCode, displayName }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [unread, setUnread] = useState(0);
    const [popupMessages, setPopupMessages] = useState([]);
    const messagesEndRef = useRef(null);
    const popupTimerRef = useRef(null);

    useEffect(() => {
        if (!socket) return;

        const onChatMessage = (msg) => {
            setMessages(prev => [...prev, msg]);
            if (!isOpen) {
                setUnread(prev => prev + 1);
                // Add to popup queue with unique ID
                const popupMsg = { ...msg, id: Date.now() + Math.random() };
                setPopupMessages(prev => {
                    const updated = [...prev, popupMsg].slice(-3); // keep latest 3
                    return updated;
                });
                // Auto-remove popup after 5s
                setTimeout(() => {
                    setPopupMessages(prev => prev.filter(m => m.id !== popupMsg.id));
                }, 5000);
            }
        };

        socket.on('chatMessage', onChatMessage);
        return () => socket.off('chatMessage', onChatMessage);
    }, [socket, isOpen]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        const text = input.trim();
        if (!text || !socket) return;

        socket.emit('chatSend', { code: roomCode, text });
        setInput('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const toggleOpen = () => {
        setIsOpen(!isOpen);
        if (!isOpen) {
            setUnread(0);
            setPopupMessages([]);
        }
    };

    return (
        <div className="friendly-chat-top">
            {/* Popup Messages (when chat is closed) */}
            {!isOpen && popupMessages.length > 0 && (
                <div className="chat-popup-area" onClick={toggleOpen}>
                    {popupMessages.map((msg) => (
                        <div key={msg.id} className="chat-popup-bubble animate-popup-slide">
                            <span className="popup-sender">{msg.sender}</span>
                            <span className="popup-text">{msg.text}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Chat Toggle Bar */}
            <div className="chat-top-bar" onClick={toggleOpen}>
                <div className="chat-top-bar-left">
                    <MessageCircle size={16} />
                    <span>Room Chat</span>
                    {unread > 0 && <span className="top-unread-badge">{unread}</span>}
                </div>
                <div className="chat-top-bar-right">
                    {isOpen ? <X size={16} /> : <ChevronDown size={16} />}
                </div>
            </div>

            {/* Full Chat Panel (drops down from top bar) */}
            <div className={`chat-dropdown-panel glass ${isOpen ? 'open' : ''}`}>
                <div className="chat-messages-area">
                    {messages.length === 0 && (
                        <div className="chat-empty-msg">No messages yet. Say hi! 👋</div>
                    )}
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            className={`chat-bubble ${msg.sender === displayName ? 'mine' : ''}`}
                        >
                            {msg.sender !== displayName && (
                                <span className="bubble-sender">{msg.sender}</span>
                            )}
                            <span className="bubble-text">{msg.text}</span>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-area">
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message..."
                        maxLength={200}
                    />
                    <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim()}>
                        <Send size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FriendlyChat;
