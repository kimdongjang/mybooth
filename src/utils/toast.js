const EVENT = 'app-toast';

export function showToast(message, type = 'success') {
  if (!message || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message: String(message), type } }));
}
export const toastEvent = EVENT;

// Messages for user-initiated commands. Commands that are not listed (reads,
// previews, background syncs, flows with their own notice) stay silent.
const successMessages = {
  updateProfile: payload => payload?.avatar === undefined ? '닉네임이 저장되었습니다.' : payload.avatar ? '프로필 이미지가 변경되었습니다.' : '프로필 이미지가 삭제되었습니다.',
  updateCredentials: '계정 정보가 변경되었습니다.',
  createProject: '행사가 추가되었습니다.',
  duplicateProject: '행사가 복제되었습니다.',
  updateProjectInfo: '행사 정보가 저장되었습니다.',
  renameProject: '행사 이름이 변경되었습니다.',
  archiveProject: '판매가 종료되었습니다.',
  unarchiveProject: '판매가 다시 열렸습니다.',
  deleteProject: '행사가 삭제되었습니다.',
  acceptEventInvite: '제작자로 참여했습니다.',
  saveEventAccess: '행사 권한이 변경되었습니다.',
  addEventArtist: '제작자가 추가되었습니다.',
  createEventCreator: '제작자가 추가되었습니다.',
  createBoothArtist: '제작자가 추가되었습니다.',
  removeEventArtist: '제작자가 삭제되었습니다.',
  linkEventArtistAccount: '계정이 연결되었습니다.',
  unlinkEventArtistAccount: '계정 연결이 해제되었습니다.',
  acceptArtistInvitation: '제작자 연결이 완료되었습니다.',
  revokeArtistInvitation: '초대가 철회되었습니다.',
  createFirstBooth: '부스가 만들어졌습니다.',
  voidSale: '판매가 취소되었습니다.',
  clearSales: '판매 내역이 삭제되었습니다.',
  addPayment: '지급이 기록되었습니다.',
  reversePayment: '지급이 취소되었습니다.',
  saveDeductions: '비용이 저장되었습니다.',
  completeRecipientSettlement: '정산이 완료되었습니다.',
  saveStockPreference: '재고 설정이 저장되었습니다.',
  confirmStockParticipation: '재고 참여가 확인되었습니다.',
  saveEventStockSchedule: '행사 일정이 저장되었습니다.',
  createEventProduct: '상품이 저장되었습니다.',
  saveEventProduct: '상품이 저장되었습니다.',
  saveEventArtistProduct: '상품이 저장되었습니다.',
  registerEventArtistProduct: '상품이 저장되었습니다.',
  saveArtistProduct: '상품이 저장되었습니다.',
  replaceProducts: '상품이 저장되었습니다.',
  replaceBundles: '세트가 저장되었습니다.',
  removeProduct: '상품이 삭제되었습니다.',
  createArtistStock: '재고가 등록되었습니다.',
  adjustArtistStock: '재고가 저장되었습니다.',
  setArtistAllocation: '재고 배정이 저장되었습니다.',
  saveArtistStockPlan: '재고 계획이 저장되었습니다.',
  importArtistStock: '재고를 가져왔습니다.',
  removeArtistStock: '재고가 삭제되었습니다.',
  recordArtistStockLoss: '재고 손실이 기록되었습니다.',
  joinArtistBooth: '부스에 참여했습니다.',
  leaveArtistBooth: '부스 참여가 종료되었습니다.',
};

function commandOf(options) {
  try {
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    return body && typeof body.action === 'string' ? body : null;
  } catch { return null; }
}

export function toastApiSuccess(options) {
  if (options?.background || String(options?.method || 'GET').toUpperCase() === 'GET') return;
  const command = commandOf(options);
  const message = command && successMessages[command.action];
  if (message) showToast(typeof message === 'function' ? message(command.payload) : message, 'success');
}

export function toastApiFailure(error, options) {
  if (options?.background || String(options?.method || 'GET').toUpperCase() === 'GET') return;
  if (error?.status === 401 || !error?.message) return;
  showToast(error.message, 'error');
}
