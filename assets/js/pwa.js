// ============================================================
//  «홈 화면에 추가» 안내
//   · 안드로이드(크롬) → 설치 버튼을 눌러 바로 설치
//   · 아이폰(사파리)   → 공유 → «홈 화면에 추가» 방법을 그림으로 안내
//   · PC              → 안내하지 않습니다 (필요 없으니까요)
//   · 이미 앱으로 열었거나, 한 번 닫았으면 다시 뜨지 않습니다.
// ============================================================
import { isLoggedIn } from "./data.js";

const KEY = "kkumttang.install.dismissed";
const DELAY = 1200;                 // 화면이 자리잡은 뒤에 조용히 올라오게

let deferred = null;                // 안드로이드가 건네주는 설치 이벤트
let shown = false;

/** 이미 홈 화면 앱으로 열었는가 */
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const ua = () => navigator.userAgent || "";
const isIOS = () =>
  /iPad|iPhone|iPod/.test(ua()) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);   // 아이패드
const isAndroid = () => /Android/.test(ua());
const isSafari = () => /Safari/.test(ua()) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(ua());
const dismissed = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
const remember = (why) => { try { localStorage.setItem(KEY, why + "|" + new Date().toISOString()); } catch {} };

export function initInstallPrompt() {
  if (isStandalone()) return;                       // 이미 앱으로 열었으면 끝
  if (dismissed()) return;                          // 예전에 닫았으면 끝

  // 안드로이드: 브라우저가 «설치할 수 있어요» 라고 알려주는 순간을 붙잡아 둡니다
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    maybeShow();
  });

  // 설치가 끝나면 배너를 치우고 기억해 둡니다
  window.addEventListener("appinstalled", () => {
    remember("installed");
    close();
  });

  // 아이폰은 알려주는 이벤트가 없어서 우리가 판단합니다
  if (isIOS() && isSafari()) setTimeout(maybeShow, DELAY);
}

/** 로그인 직후처럼 «자리잡은» 시점에 한 번 더 확인 */
export function nudgeInstallPrompt() {
  if (!shown) setTimeout(maybeShow, 400);
}

function maybeShow() {
  if (shown || isStandalone() || dismissed()) return;
  if (!isIOS() && !isAndroid()) return;             // PC 는 안내하지 않습니다
  if (isAndroid() && !deferred) return;             // 설치 이벤트가 아직이면 기다립니다
  if (isIOS() && !isSafari()) return;               // 아이폰은 사파리에서만 됩니다
  shown = true;
  setTimeout(render, isLoggedIn() ? 200 : DELAY);
}

function close(why) {
  if (why) remember(why);
  document.getElementById("installBar")?.remove();
}

function render() {
  if (document.getElementById("installBar")) return;
  const bar = document.createElement("div");
  bar.id = "installBar";
  bar.className = "install-bar";

  bar.innerHTML = isAndroid() ? `
    <img class="ib-icon" src="./assets/icons/icon-192.png" alt="">
    <div class="ib-text">
      <b>앱처럼 쓰실 수 있어요</b>
      <span>홈 화면에 추가하면 주소를 찾지 않아도 바로 열립니다.</span>
    </div>
    <button class="btn btn-primary btn-sm" id="ibInstall">설치하기</button>
    <button class="icon-btn ib-x" id="ibClose" aria-label="닫기">✕</button>`
  : `
    <img class="ib-icon" src="./assets/icons/icon-192.png" alt="">
    <div class="ib-text">
      <b>홈 화면에 추가하면 앱처럼 열려요</b>
      <span class="ib-steps">
        아래 <i class="ib-share" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 16V4"/><path d="m8 8 4-4 4 4"/>
            <path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>
          </svg></i> 공유 버튼 → <b>«홈 화면에 추가»</b>
      </span>
    </div>
    <button class="icon-btn ib-x" id="ibClose" aria-label="닫기">✕</button>
    <span class="ib-arrow" aria-hidden="true">▾</span>`;

  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add("on"));

  bar.querySelector("#ibClose").addEventListener("click", () => close("dismissed"));
  bar.querySelector("#ibInstall")?.addEventListener("click", async () => {
    if (!deferred) return close("dismissed");
    const btn = bar.querySelector("#ibInstall");
    btn.disabled = true;
    deferred.prompt();
    try {
      const { outcome } = await deferred.userChoice;
      close(outcome === "accepted" ? "installed" : "dismissed");
    } catch {
      close("dismissed");
    }
    deferred = null;
  });
}
