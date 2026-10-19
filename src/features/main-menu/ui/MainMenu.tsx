import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MenuButton } from '../../../shared/ui/MenuButton';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppMode } from '../../../entities/laboratory';
import { useLaboratoryStore } from '../../../stores/laboratory/useLaboratoryStore';

export function MainMenu() {
    const [activeTab, setActiveTab] = useState<'play' | 'settings' | 'exit' | null>(null);
    const navigate = useNavigate();

    const startMode = (mode: AppMode) => {
        useLaboratoryStore.getState().setMode(mode);
        navigate('/lab');
    };

    // Логика закрытия приложения через Tauri API
    const handleExitConfirm = async () => {
        try {
            const win = getCurrentWindow();
            await win.close();
        } catch {
            window.close(); // Запасной вариант для браузера
        }
    };

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            backgroundColor: '#0f172a',
            backgroundImage: 'radial-gradient(circle at 50% 50%, #1e293b 0%, #0f172a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontFamily: 'sans-serif',
            overflow: 'hidden'
        }}>
            <div style={{ display: 'flex', gap: '40px', width: '850px', alignItems: 'center' }}>

                {/* ЛЕВАЯ ЧАСТЬ: КНОПКИ МЕНЮ */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '260px' }}>
                    <h1 style={{ fontSize: '26px', marginBottom: '20px', letterSpacing: '1px' }}>
                        VIRTUUGENIUM LAB
                    </h1>

                    <MenuButton
                        text="Играть"
                        isActive={activeTab === 'play'}
                        onClick={() => setActiveTab('play')}
                    />
                    <MenuButton
                        text="Настройки"
                        isActive={activeTab === 'settings'}
                        onClick={() => setActiveTab('settings')}
                    />
                    <MenuButton
                        text="Выход"
                        isActive={activeTab === 'exit'}
                        onClick={() => setActiveTab('exit')}
                    />
                </div>

                {/* ПРАВАЯ ЧАСТЬ: ВЫПЛЫВАЮЩИЕ ПАНЕЛИ */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>

                    {/* Вкладка: ИГРАТЬ (перенаправляет в лабораторию) */}
                    {activeTab === 'play' && (
                        <PanelContainer>
                            <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#38bdf8' }}>Новая игра</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <ModeCard
                                    title="Обучение"
                                    description="Базовое знакомство с правилами техники безопасности, средствами защиты (СИЗ) и базовым оборудованием лаборатории."
                                    onClick={() => startMode('training')}
                                />
                                <ModeCard
                                    title="Классический"
                                    description="Полный процесс работы с использованием справочной книги. Проходите задания, пишите уравнения реакций и получайте баллы."
                                    onClick={() => startMode('classic')}
                                />
                                <ModeCard
                                    title="Чистый эксперимент"
                                    description="Режим быстрой практики. Выберите конкретный химический опыт из списка в планшете и сразу приступайте к его проведению."
                                    onClick={() => startMode('clean')}
                                />
                            </div>
                        </PanelContainer>
                    )}

                    {/* Вкладка: НАСТРОЙКИ */}
                    {activeTab === 'settings' && (
                        <PanelContainer>
                            <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#38bdf8' }}>Настройки</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <SettingSlider label="Общая громкость" />
                                <SettingSlider label="Громкость эффектов (звуки реакций)" />
                                <SettingSlider label="Размер текста интерфейса" />
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: '#cbd5e1' }}>Разрешение экрана</label>
                                    <select style={{ width: '100%', padding: '8px', backgroundColor: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', outline: 'none' }}>
                                        <option>1920 x 1080</option>
                                        <option>2560 x 1440</option>
                                        <option>1280 x 720</option>
                                    </select>
                                </div>
                            </div>
                        </PanelContainer>
                    )}

                    {/* Вкладка: ВЫХОД */}
                    {activeTab === 'exit' && (
                        <PanelContainer>
                            <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                <h2 style={{ fontSize: '20px', marginBottom: '10px', color: '#f87171' }}>Вы уверены?</h2>
                                <p style={{ marginBottom: '25px', color: '#94a3b8', fontSize: '14px' }}>Все несохраненные результаты экспериментов будут потеряны.</p>
                                <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                                    <ConfirmButton text="Да" onClick={handleExitConfirm} isDanger={true} />
                                    <ConfirmButton text="Отмена" onClick={() => setActiveTab(null)} />
                                </div>
                            </div>
                        </PanelContainer>
                    )}

                    {!activeTab && (
                        <p style={{ color: '#64748b', fontSize: '14px', paddingLeft: '20px' }}>Выберите пункт меню слева</p>
                    )}

                </div>
            </div>
        </div>
    );
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ПАНЕЛИ
// ==========================================

function PanelContainer({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '25px',
            width: '100%',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)'
        }}>
            {children}
        </div>
    );
}

function ModeCard({ title, description, onClick }: { title: string, description: string, onClick: () => void }) {
    const [isHovered, setIsHovered] = useState(false);
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                padding: '12px 15px',
                backgroundColor: isHovered ? 'rgba(56, 189, 248, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                borderLeft: `4px solid ${isHovered ? '#38bdf8' : 'transparent'}`,
                borderRadius: '0 6px 6px 0',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
            }}
        >
            <h3 style={{ fontSize: '15px', marginBottom: '4px', color: isHovered ? '#38bdf8' : 'white' }}>{title}</h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.4' }}>{description}</p>
        </div>
    );
}

function SettingSlider({ label }: { label: string }) {
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '13px', color: '#cbd5e1' }}>{label}</label>
            </div>
            <input type="range" min="0" max="100" defaultValue="50" style={{ width: '100%', cursor: 'pointer' }} />
        </div>
    );
}

function ConfirmButton({ text, onClick, isDanger = false }: { text: string, onClick: () => void, isDanger?: boolean }) {
    const [isHovered, setIsHovered] = useState(false);
    const baseColor = isDanger ? '#ef4444' : '#38bdf8';
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                padding: '8px 25px',
                backgroundColor: isHovered ? `${baseColor}20` : 'rgba(0,0,0,0.3)',
                border: `1px solid ${isHovered ? baseColor : 'rgba(255,255,255,0.2)'}`,
                color: isHovered ? baseColor : 'white',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'all 0.2s ease'
            }}
        >
            {text}
        </button>
    );
}