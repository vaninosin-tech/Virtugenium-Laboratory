import { Component, Suspense, useState, useEffect, useRef, useMemo, type ComponentRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { PointerLockControls, Environment, useGLTF, PresentationControls } from '@react-three/drei';
import * as THREE from 'three';
import { useLaboratoryStore } from "../../../stores/laboratory/useLaboratoryStore";
import { DEFAULT_LIQUID_COLOR } from "../../../stores/laboratory/initialState";

// --- ОГРАНИЧИТЕЛЬ ОШИБОК 3D-ОБЪЕКТОВ ---
// HDR-окружение загружается из сети: без интернета загрузка падает,
// и без этой обёртки ошибка размонтировала бы всё приложение.
class SceneErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.warn('Не удалось загрузить объект сцены:', error);
    }

    render() {
        return this.state.hasError ? null : this.props.children;
    }
}

// --- ИГРОК (Управление и физика) ---
function Player({ onLock, onUnlock }: { onLock: () => void, onUnlock: () => void }) {
    const controlsRef = useRef<ComponentRef<typeof PointerLockControls>>(null);
    const moveState = useRef({ forward: false, backward: false, left: false, right: false });
    const velocity = useRef(new THREE.Vector3());
    const direction = useRef(new THREE.Vector3());

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            switch (e.code) {
                case 'KeyW': moveState.current.forward = true; break;
                case 'KeyA': moveState.current.left = true; break;
                case 'KeyS': moveState.current.backward = true; break;
                case 'KeyD': moveState.current.right = true; break;
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            switch (e.code) {
                case 'KeyW': moveState.current.forward = false; break;
                case 'KeyA': moveState.current.left = false; break;
                case 'KeyS': moveState.current.backward = false; break;
                case 'KeyD': moveState.current.right = false; break;
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    useFrame((_, delta: number) => {
        if (!controlsRef.current?.isLocked) return;
        const dt = Math.min(delta, 0.1);
        const v = velocity.current;
        const d = direction.current;
        const m = moveState.current;

        v.x -= v.x * 10.0 * dt;
        v.z -= v.z * 10.0 * dt;
        d.z = Number(m.forward) - Number(m.backward);
        d.x = Number(m.right) - Number(m.left);
        d.normalize();

        if (m.forward || m.backward) v.z -= d.z * 40.0 * dt;
        if (m.left || m.right) v.x -= d.x * 40.0 * dt;

        controlsRef.current.moveRight(-v.x * dt);
        controlsRef.current.moveForward(-v.z * dt);
    });

    return (
        <PointerLockControls
            ref={controlsRef}
            onLock={onLock}
            onUnlock={onUnlock}
            selector="#walk-btn"
        />
    );
}

// --- ИНТЕРАКТИВНАЯ КОЛБА С ВОДОЙ И СМЕНОЙ ЦВЕТА ---
function InteractiveFlask() {
    const { scene } = useGLTF('/flask.glb');

    // Состояние цвета воды (по умолчанию синий)
    const liquidColor = useLaboratoryStore((state) => state.liquidColor);
    const toggleLiquidColor = useLaboratoryStore((state) => state.toggleLiquidColor);

    // ВАЖНО: Колба теперь висит на высоте 1.0. 
    // Значит, лазер отсечения воды должен быть чуть выше её центра, например на 1.15.
    // Если при вращении вода всё ещё крутится куском — уменьши 1.15 до 1.05.
    const clippingPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.15), []);

    const glassMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.05,
        metalness: 0.1,
        transmission: 0.95,
        ior: 1.5,
        transparent: true,
        thickness: 0.5,
        depthWrite: false
    }), []);

    // Материал воды создаётся один раз, цвет меняется в эффекте ниже
    const waterMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: DEFAULT_LIQUID_COLOR,
        emissive: DEFAULT_LIQUID_COLOR,
        emissiveIntensity: 0.2,
        roughness: 0.1,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        clippingPlanes: [clippingPlane]
    }), [clippingPlane]);

    // Освобождаем GPU-ресурсы материалов при размонтировании сцены
    useEffect(() => () => {
        glassMaterial.dispose();
        waterMaterial.dispose();
    }, [glassMaterial, waterMaterial]);

    useEffect(() => {
        waterMaterial.color.set(liquidColor);
        waterMaterial.emissive.set(liquidColor);
    }, [waterMaterial, liquidColor]);

    useEffect(() => {
        scene.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
                const mesh = node as THREE.Mesh;
                const name = mesh.name.toLowerCase();

                if (name.includes('liquid') || name.includes('water') || name.includes('жидк')) {
                    mesh.material = waterMaterial;
                } else {
                    mesh.material = glassMaterial;
                }
            }
        });
    }, [scene, glassMaterial, waterMaterial]);

    // Смена цвета по двойному клику
    const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation(); // Чтобы клик не ушел дальше на другие объекты
        toggleLiquidColor();
    };

    return (
        <PresentationControls
            global={false}
            cursor={true}
            snap={true}
            speed={2}
            polar={[-0.4, 0.4]}
            azimuth={[-1, 1]}
        >
            <primitive
                object={scene}
                position={[0, 1.0, 0]} // Колба висит в воздухе прямо перед глазами
                scale={0.6}
                onDoubleClick={handleDoubleClick} // Вешаем обработчик двойного клика
            />
        </PresentationControls>
    );
}

// --- ОСНОВНАЯ СЦЕНА ---
export function Laboratory() {
    const navigate = useNavigate();
    const setScreen = useLaboratoryStore((state) => state.setScreen);
    const [isLocked, setIsLocked] = useState(false);

    const goToMainMenu = () => {
        setScreen('main-menu');
        navigate('/');
    };

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
            <Canvas
                camera={{ position: [0, 1.5, 3], fov: 75 }}
                gl={{
                    powerPreference: "high-performance",
                    antialias: true,
                    localClippingEnabled: true
                }}
            >
                <SceneErrorBoundary>
                    <Suspense fallback={null}>
                        <Environment preset="warehouse" background blur={0.08} />
                    </Suspense>
                </SceneErrorBoundary>
                <ambientLight intensity={1.2} color="#cbd5e1" />
                <pointLight position={[0, 2.5, 0]} intensity={15.0} color="#38bdf8" distance={5} />

                {/* Только пол. Стол удален. */}
                <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[30, 30]} />
                    <meshStandardMaterial color="#0f172a" roughness={0.9} />
                </mesh>

                <SceneErrorBoundary>
                    <Suspense fallback={null}>
                        <InteractiveFlask />
                    </Suspense>
                </SceneErrorBoundary>
                <Player onLock={() => setIsLocked(true)} onUnlock={() => setIsLocked(false)} />
            </Canvas>

            {/* --- UI ИНТЕРФЕЙС --- */}
            <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10 }}>
                <button onClick={goToMainMenu} style={{ padding: '10px 20px', backgroundColor: 'rgba(15, 23, 42, 0.85)', color: '#38bdf8', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
                    ← В главное меню
                </button>
            </div>

            {isLocked && (
                <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10, backgroundColor: 'rgba(15, 23, 42, 0.7)', padding: '10px 20px', borderRadius: '8px', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' }}>
                    Нажми <b>ESC</b>, чтобы взаимодействовать
                </div>
            )}

            {!isLocked && (
                <div style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>

                    <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: '15px 30px', borderRadius: '12px', textAlign: 'center', border: '1px solid #38bdf8', boxShadow: '0 4px 20px rgba(56, 189, 248, 0.2)' }}>
                        <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#fff' }}>Режим взаимодействия</p>
                        <p style={{ margin: '5px 0 0 0', fontSize: '14px', color: '#cbd5e1' }}>Тяни мышью — чтобы крутить. <b>Двойной клик</b> — сменить цвет.</p>
                    </div>

                    <button
                        id="walk-btn"
                        style={{ padding: '12px 30px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#38bdf8', color: '#0f172a', borderRadius: '8px', cursor: 'pointer', border: 'none', transition: '0.2s' }}
                    >
                        Управлять персонажем (WASD)
                    </button>

                </div>
            )}
        </div>
    );
}

useGLTF.preload('/flask.glb');