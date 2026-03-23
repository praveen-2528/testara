import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { ChevronLeft, Lock, CheckCircle, AlertCircle, User, Mail, Calendar } from 'lucide-react';
import './Settings.css';

const Settings = () => {
    const navigate = useNavigate();
    const { user, authFetch } = useAuth();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [msg, setMsg] = useState({ type: '', text: '' });
    const [loading, setLoading] = useState(false);

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setMsg({ type: '', text: '' });

        if (newPassword.length < 6) return setMsg({ type: 'error', text: 'New password must be at least 6 characters.' });
        if (newPassword !== confirmPassword) return setMsg({ type: 'error', text: 'Passwords do not match.' });

        setLoading(true);
        try {
            const res = await authFetch('/api/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setMsg({ type: 'success', text: 'Password changed successfully!' });
            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        } catch (err) {
            setMsg({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="settings-container animate-fade-in">
            <div className="settings-header">
                <h1>⚙️ Settings</h1>
                <p>Manage your account</p>
            </div>

            {/* Profile Card */}
            <Card className="profile-card glass">
                <h3>Profile</h3>
                <div className="profile-fields">
                    <div className="profile-row">
                        <User size={16} />
                        <span className="profile-label">Name</span>
                        <span className="profile-value">{user?.name}</span>
                    </div>
                    <div className="profile-row">
                        <Mail size={16} />
                        <span className="profile-label">Email</span>
                        <span className="profile-value">{user?.email}</span>
                    </div>
                    <div className="profile-row">
                        <Calendar size={16} />
                        <span className="profile-label">Joined</span>
                        <span className="profile-value">
                            {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </span>
                    </div>
                </div>
            </Card>

            {/* Change Password Card */}
            <Card className="password-card glass">
                <h3><Lock size={18} /> Change Password</h3>
                <form onSubmit={handleChangePassword} className="password-form">
                    <input
                        type="password"
                        placeholder="Current Password"
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        required
                    />
                    <input
                        type="password"
                        placeholder="New Password (min 6 chars)"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                    />
                    <input
                        type="password"
                        placeholder="Confirm New Password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                    />

                    {msg.text && (
                        <div className={`settings-msg ${msg.type}`}>
                            {msg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                            {msg.text}
                        </div>
                    )}

                    <Button type="submit" variant="primary" disabled={loading}>
                        {loading ? 'Changing...' : 'Change Password'}
                    </Button>
                </form>
            </Card>

            <div className="settings-back">
                <Button variant="ghost" onClick={() => navigate('/')}><ChevronLeft size={16} /> Back</Button>
            </div>
        </div>
    );
};

export default Settings;
