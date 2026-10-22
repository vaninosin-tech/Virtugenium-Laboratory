import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MainMenu } from '../features/main-menu/ui/MainMenu';
import { Laboratory } from '../scenes/laboratory/ui/Laboratory';
import { ClickFeedback } from '../shared/ui/ClickFeedback';

export default function App() {
    return (
        <BrowserRouter>
            <ClickFeedback />
            <Routes>
                <Route path="/" element={<MainMenu />} />
                <Route path="/lab" element={<Laboratory />} />
            </Routes>
        </BrowserRouter>
    );
}