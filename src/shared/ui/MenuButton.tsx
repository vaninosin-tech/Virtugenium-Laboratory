import { useState } from 'react';

interface MenuButtonProps {
    text: string;
    isActive: boolean;
    onClick: () => void;
}

export function MenuButton({ text, isActive, onClick }: MenuButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const greenColor = '#10b981'; // Изумрудно-зеленый оттенок при наведении

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 20px',
                backgroundColor: isActive ? 'rgba(56, 189, 248, 0.2)' : (isHovered ? `rgba(16, 185, 129, 0.15)` : 'rgba(0, 0, 0, 0.3)'),
                border: `1px solid ${isActive ? '#38bdf8' : (isHovered ? greenColor : 'rgba(255, 255, 255, 0.1)')}`,
                color: isActive ? '#38bdf8' : (isHovered ? greenColor : '#e2e8f0'),
                borderRadius: '25px',
                cursor: 'pointer',
                fontSize: '16px',
                transition: 'all 0.2s ease',
                width: '100%',
                textAlign: 'left'
            }}
        >
            <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                backgroundColor: isActive ? '#38bdf8' : (isHovered ? greenColor : 'rgba(255, 255, 255, 0.2)'),
                transition: 'all 0.2s ease'
            }} />
            {text}
        </button>
    );
}