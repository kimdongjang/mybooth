import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const tips = {
  menu: ['3 · 행사 판매 설정으로 이동', '행사 판매 설정에서 상품을 등록하고 창고 재고를 배정하세요.'],
  event: ['1 · 행사 등록', '새 행사 추가를 눌러 참가할 행사를 만들어보세요. 상품은 내 재고에서 공통으로 관리하고 판매 내역은 행사별로 보관합니다.'],
  eventSave: ['2 · 행사 저장', '행사 이름을 입력하고 이 버튼을 누르세요. 저장이 완료되면 판매 화면이 열립니다.'],
  manage: ['3 · 행사 판매 설정으로 이동', '행사 판매 설정에서 상품의 판매가와 행사 재고를 설정하세요.'],
  add: ['4 · 상품 등록', '상품 추가를 눌러 굿즈 정보, 판매가와 초기 재고를 입력하세요. 여러 이미지는 옆의 일괄 추가로 등록할 수 있어요.'],
  save: ['5 · 상품 저장', '필수 정보를 입력한 뒤 상품 저장을 누르세요. 무료 상품은 판매가를 0원으로 등록할 수 있어요.'],
  detail: ['6 · 등록한 상품 관리', '상품 이름을 누르면 상세 화면이 열려요. 정보와 판매가를 수정하고 재고를 관리할 수 있습니다.'],
  edit: ['마지막 · 수정 내용 저장', '행사 판매 정보를 바꾼 뒤 수정 버튼을 누르세요. 수량은 내 재고에서 배정·회수하고 이미지는 별도로 등록합니다.'],
};

// Test rollout: every authenticated user gets tips on each fresh app load.
// No account flags or persistent completion records are written.
export default function GettingStarted({ scope }) {
  const [enabled, setEnabled] = useState(true);
  const [seen, setSeen] = useState([]);
  const [anchor, setAnchor] = useState(null);
  const [position, setPosition] = useState(null);
  const panel = useRef(null);
  useEffect(() => {
    if (!enabled) { setAnchor(null); return; }
    const find = () => {
      const element = [...document.querySelectorAll('[data-guide]')].find(node =>
        !seen.includes(node.dataset.guide) && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      setAnchor(element || null);
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.getElementById('root'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-guide'] });
    return () => observer.disconnect();
  }, [enabled, seen, scope]);
  const id = anchor?.dataset.guide;
  useEffect(() => {
    if (!anchor) { setPosition(null); return; }
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(336, window.innerWidth - 24);
      const height = panel.current?.offsetHeight || 200;
      setPosition(rect.bottom < 0 || rect.top > window.innerHeight ? null : {
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: rect.bottom + height + 24 <= window.innerHeight ? rect.bottom + 12 : Math.max(12, rect.top - height - 12), width,
      });
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(anchor);
    if (panel.current) resize.observe(panel.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const advance = () => setSeen(previous => [...previous, id]);
    anchor.addEventListener('click', advance);
    const escape = event => { if (event.key === 'Escape') setEnabled(false); };
    document.addEventListener('keydown', escape);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      anchor.removeEventListener('click', advance);
      document.removeEventListener('keydown', escape);
    };
  }, [anchor, id]);
  return <>
    <button type="button" className="guide-launcher" onClick={() => { setSeen([]); setEnabled(!enabled); }}>{enabled ? '가이드 끄기' : '시작 가이드'}</button>
    {anchor && tips[id] && createPortal(<aside ref={panel} className="getting-started" style={position || { visibility: 'hidden' }} aria-label="시작 가이드" aria-live="polite">
      <div className="guide-eyebrow">처음 시작하는 WithBooth <span>전체 사용자 테스트</span></div>
      <strong>{tips[id][0]}</strong><p>{tips[id][1]}</p>
      <div className="guide-actions"><button type="button" onClick={() => setEnabled(false)}>가이드 닫기</button><button type="button" onClick={() => setSeen(previous => [...previous, id])}>확인했어요</button></div>
    </aside>, document.body)}
  </>;
}
