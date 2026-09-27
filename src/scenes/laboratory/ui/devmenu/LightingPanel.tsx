import { useLightingStore } from "../../lib/useLightingStore";
import { useFumeHoodControlsStore } from "../../lib/useFumeHoodControlsStore";

export function LightingPanel() {
  const { groupA, groupB, setGroupA, setGroupB } = useLightingStore();
  const hood = useFumeHoodControlsStore(state => state.lightOnById["fume-hood"] ?? false);
  const setLight = useFumeHoodControlsStore(state => state.setLight);
  return <div style={{ display: "grid", gap: 12, padding: 12 }}>
    <label><input type="checkbox" checked={groupA} onChange={e => setGroupA(e.target.checked)} /> Потолок — группа A (1, 3, 5)</label>
    <label><input type="checkbox" checked={groupB} onChange={e => setGroupB(e.target.checked)} /> Потолок — группа B (2, 4, 6)</label>
    <label><input type="checkbox" checked={hood} onChange={e => setLight("fume-hood", e.target.checked)} /> Лампа вытяжного шкафа</label>
    <button onClick={() => { setGroupA(false); setGroupB(false); setLight("fume-hood", false); }}>Выключить все лампы</button>
    <p style={{ margin: 0 }}>Выключите лампы, затем включайте по одной группе. Сравните стены и столешницу. Лампа вытяжки освещает рабочую камеру. Слабый фоновый свет остаётся.</p>
  </div>;
}
