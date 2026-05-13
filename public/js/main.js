(() => {
  const nav = document.querySelector('.site-nav');
  const track = nav?.querySelector('.nav-track');
  const underline = nav?.querySelector('.nav-underline');
  const links = nav ? Array.from(nav.querySelectorAll('.nav-link')) : [];
  const panels = Array.from(document.querySelectorAll('[data-board-panel]'));

  function moveUnderline(activeBtn) {
    if (!track || !underline || !activeBtn) return;
    const t = track.getBoundingClientRect();
    const r = activeBtn.getBoundingClientRect();
    underline.style.width = `${r.width}px`;
    underline.style.transform = `translateX(${r.left - t.left}px)`;
  }

  function setActiveBoard(boardId) {
    links.forEach((btn) => {
      const on = btn.dataset.board === boardId;
      btn.classList.toggle('is-active', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    panels.forEach((panel) => {
      const match = panel.dataset.boardPanel === boardId;
      panel.hidden = !match;
      panel.classList.toggle('is-visible', match);
    });

    document.body.classList.toggle('is-mypage-route', boardId === 'mypage');

    const activeBtn = links.find((b) => b.dataset.board === boardId);
    requestAnimationFrame(() => moveUnderline(activeBtn));

    if (boardId === 'mypage') {
      queueMicrotask(() => {
        loadMypageProfileForm();
      });
    }
  }

  links.forEach((btn) => {
    btn.addEventListener('click', () => setActiveBoard(btn.dataset.board));
  });

  window.addEventListener('resize', () => {
    const activeBtn = links.find((b) => b.classList.contains('is-active'));
    moveUnderline(activeBtn);
  });

  window.addEventListener('load', () => {
    const activeBtn = links.find((b) => b.classList.contains('is-active'));
    requestAnimationFrame(() => moveUnderline(activeBtn));
  });

  setActiveBoard('main');

  const modal = document.getElementById('signup-modal');
  const openSignup = document.getElementById('open-signup');
  const closeBackdropEls = modal?.querySelectorAll('[data-close-modal]');
  const profileFile = document.getElementById('profile-file');
  const profileTrigger = document.getElementById('profile-file-trigger');
  const profilePreview = document.getElementById('profile-preview');

  const modalBack = document.getElementById('signup-modal-back');
  const headAccount = document.getElementById('signup-head-account');
  const headCharacters = document.getElementById('signup-head-characters');
  const stepAccount = document.getElementById('signup-step-account');
  const stepCharacters = document.getElementById('signup-step-characters');
  const footerAccount = document.getElementById('signup-footer-account');
  const footerCharacters = document.getElementById('signup-footer-characters');
  const characterGrid = document.getElementById('character-grid');
  const characterGridScroll = modal?.querySelector('.character-grid-scroll');
  const characterLoadError = document.getElementById('character-load-error');
  const deferCheckbox = document.getElementById('defer-characters-later');
  const signupNext = document.getElementById('signup-next');
  const signupSubmit = document.getElementById('signup-submit');

  const nicknameInput = document.getElementById('nickname');
  const useridInput = document.getElementById('userid');
  const passwordInput = document.getElementById('password');
  const password2Input = document.getElementById('password2');
  const signupRecaptchaWrap = document.getElementById('signup-recaptcha-wrap');
  const signupCaptchaSvg = document.getElementById('signup-captcha-svg');
  const signupCaptchaRefresh = document.getElementById('signup-captcha-refresh');
  const signupCaptchaAnswer = document.getElementById('signup-captcha-answer');
  const signupStep1Alert = document.getElementById('signup-step1-alert');
  const passwordVisibilityBtn = document.getElementById('password-visibility');
  const password2VisibilityBtn = document.getElementById('password2-visibility');
  const passwordMatchFeedbackEl = document.getElementById('password-match-feedback');
  const profileCropModal = document.getElementById('profile-crop-modal');
  const profileCropCanvas = document.getElementById('profile-crop-canvas');
  const profileCropStage = document.getElementById('profile-crop-stage');
  const profileCropZoom = document.getElementById('profile-crop-zoom');
  const profileCropZoomPct = document.getElementById('profile-crop-zoom-pct');
  const profileCropCancel = document.getElementById('profile-crop-cancel');
  const profileCropConfirm = document.getElementById('profile-crop-confirm');
  const profileCropRotate = document.getElementById('profile-crop-rotate');
  const profileCropBackdrop = document.getElementById('profile-crop-backdrop');

  const USERNAME_RE_CLIENT = /^[a-zA-Z0-9_]{8,20}$/;
  const NICKNAME_LEN_MIN = 2;
  const NICKNAME_LEN_MAX = 10;
  const PASSWORD_LEN_MIN = 8;

  function nicknameCharCount(s) {
    return [...String(s || '')].length;
  }

  let signupStep = 1;
  let charactersCache = null;
  let selectedCharacterIds = new Set();
  let charactersLoadPromise = null;
  let publicCfg = { recaptchaSiteKey: null };
  let recaptchaWidgetId = null;
  let recaptchaApiPromise = null;
  let signupCaptchaId = '';
  let signupStepPassToken = '';
  let croppedProfileDataUrl = null;
  let pendingCropObjectUrl = null;
  let cropImg = null;
  let cropPanX = 0;
  let cropPanY = 0;
  let cropRotation = 0;
  let cropDragging = false;
  let cropLastPointerX = 0;
  let cropLastPointerY = 0;
  let profilePreviewUrl = null;
  /** 'signup' | 'mypage' — 프로필 크롭 확인 시 어디에 반영할지 구분 */
  let profileCropContext = 'signup';

  let mypageSessionUserId = '';
  let mypageBaselineNickname = '';
  let mypageBaselineProfileImage = '';
  let mypageNicknameApprovedFor = null;
  let mypagePendingProfileDataUrl = null;

  function syncRecaptchaWrapVisibility() {
    if (!signupRecaptchaWrap) return;
    signupRecaptchaWrap.hidden = !publicCfg.recaptchaSiteKey;
  }

  async function refreshPublicRuntimeConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json().catch(() => ({}));
      const key =
        typeof data.recaptchaSiteKey === 'string' && data.recaptchaSiteKey.trim()
          ? data.recaptchaSiteKey.trim()
          : null;
      publicCfg = { recaptchaSiteKey: key };
    } catch {
      publicCfg = { recaptchaSiteKey: null };
    }
    syncRecaptchaWrapVisibility();
  }

  function resetRecaptchaWidget() {
    if (recaptchaWidgetId === null || !window.grecaptcha) return;
    try {
      window.grecaptcha.reset(recaptchaWidgetId);
    } catch (_) {
      /* ignore */
    }
  }

  function loadRecaptchaApi() {
    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') return Promise.resolve();
    if (recaptchaApiPromise) return recaptchaApiPromise;
    const cbName = '__pcrRecaptchaExplicitLoadCb';
    recaptchaApiPromise = new Promise((resolve, reject) => {
      window[cbName] = () => {
        try {
          delete window[cbName];
        } catch (_) {
          /* ignore */
        }
        resolve();
      };
      const s = document.createElement('script');
      s.async = true;
      s.defer = true;
      s.src = `https://www.google.com/recaptcha/api.js?onload=${cbName}&render=explicit`;
      s.onerror = () => {
        try {
          delete window[cbName];
        } catch (_) {
          /* ignore */
        }
        recaptchaApiPromise = null;
        reject(new Error('reCAPTCHA 스크립트를 불러올 수 없습니다.'));
      };
      document.head.appendChild(s);
    });
    return recaptchaApiPromise;
  }

  async function renderSignupRecaptchaOnce() {
    if (!publicCfg.recaptchaSiteKey) return;
    const mount = document.getElementById('signup-recaptcha');
    if (!mount || recaptchaWidgetId !== null) return;
    await loadRecaptchaApi();
    recaptchaWidgetId = window.grecaptcha.render(mount, {
      sitekey: publicCfg.recaptchaSiteKey,
    });
  }

  function setSignupStep(step) {
    signupStep = step;
    const is1 = step === 1;
    if (stepAccount) stepAccount.hidden = !is1;
    if (stepCharacters) stepCharacters.hidden = is1;
    if (headAccount) headAccount.hidden = !is1;
    if (headCharacters) headCharacters.hidden = is1;
    if (footerAccount) {
      footerAccount.hidden = !is1;
      footerAccount.setAttribute('aria-hidden', is1 ? 'false' : 'true');
    }
    if (footerCharacters) {
      footerCharacters.hidden = is1;
      footerCharacters.setAttribute('aria-hidden', is1 ? 'true' : 'false');
    }
    if (modal) {
      const label = is1 ? 'signup-heading' : 'signup-heading-characters';
      modal.setAttribute('aria-labelledby', label);
    }
    if (is1) syncSignupNextButton();
  }

  async function loadSignupCaptcha() {
    if (!signupCaptchaSvg) return;
    signupCaptchaSvg.innerHTML = '';
    signupCaptchaId = '';
    if (signupCaptchaAnswer) signupCaptchaAnswer.value = '';
    try {
      const res = await fetch('/api/signup/captcha');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.svg || !data.id) return;
      signupCaptchaId = data.id;
      signupCaptchaSvg.innerHTML = data.svg;
    } catch {
      /* ignore */
    }
  }

  function clearSignupStep1Alert() {
    if (!signupStep1Alert) return;
    signupStep1Alert.textContent = '';
    signupStep1Alert.hidden = true;
  }

  function setSignupStep1Alert(message) {
    if (!signupStep1Alert) return;
    if (!message) {
      clearSignupStep1Alert();
      return;
    }
    signupStep1Alert.textContent = message;
    signupStep1Alert.hidden = false;
  }

  function getFirstSignupStep1ValidationError() {
    const nickname = nicknameInput?.value.trim() || '';
    const username = useridInput?.value.trim() || '';
    const password = passwordInput?.value || '';
    const password2 = password2Input?.value || '';
    const captchaAnswer = signupCaptchaAnswer?.value?.trim() || '';

    if (!nickname) return '닉네임을 입력해 주세요.';
    const nLen = nicknameCharCount(nickname);
    if (nLen < NICKNAME_LEN_MIN || nLen > NICKNAME_LEN_MAX) {
      return `닉네임은 ${NICKNAME_LEN_MIN}~${NICKNAME_LEN_MAX}자로 입력해 주세요.`;
    }
    if (nicknameApprovedFor !== nickname) return '닉네임 중복 확인을 해 주세요.';

    if (!username) return '아이디를 입력해 주세요.';
    if (!USERNAME_RE_CLIENT.test(username)) {
      return '아이디는 영문·숫자·밑줄만 사용하고 8~20자로 입력해 주세요.';
    }
    if (usernameApprovedFor !== username) return '아이디 중복 확인을 해 주세요.';

    if (!password) return '비밀번호를 입력해 주세요.';
    if (password.length < PASSWORD_LEN_MIN) {
      return `비밀번호는 ${PASSWORD_LEN_MIN}자 이상 입력해 주세요.`;
    }
    if (!password2) return '비밀번호 확인을 입력해 주세요.';
    if (password !== password2) return '비밀번호 확인이 일치하지 않습니다.';

    if (!signupCaptchaId) {
      return '보안 문자 이미지를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.';
    }
    if (!captchaAnswer) return '보안 문자를 입력해 주세요.';

    return null;
  }

  function syncPasswordMatchFeedback() {
    if (!passwordMatchFeedbackEl) return;
    const a = passwordInput?.value || '';
    const b = password2Input?.value || '';
    if (!b) {
      passwordMatchFeedbackEl.textContent = '';
      passwordMatchFeedbackEl.classList.remove('is-ok', 'is-warn');
      return;
    }
    if (a === b) {
      passwordMatchFeedbackEl.textContent = '비밀번호가 일치합니다.';
      passwordMatchFeedbackEl.classList.remove('is-warn');
      passwordMatchFeedbackEl.classList.add('is-ok');
    } else {
      passwordMatchFeedbackEl.textContent = '비밀번호가 일치하지 않습니다.';
      passwordMatchFeedbackEl.classList.remove('is-ok');
      passwordMatchFeedbackEl.classList.add('is-warn');
    }
  }

  function syncPasswordStrengthBadge() {
    const el = document.getElementById('password-strength-badge');
    if (!el || !passwordInput) return;
    const p = passwordInput.value;
    if (!p) {
      el.hidden = true;
      el.textContent = '안전';
      el.classList.remove('is-safe', 'is-mid', 'is-weak');
      return;
    }
    el.hidden = false;
    const hasLetter = /[a-zA-Z]/.test(p);
    const hasNum = /\d/.test(p);
    const hasSym = /[^a-zA-Z0-9]/.test(p);
    const variety = [hasLetter, hasNum, hasSym].filter(Boolean).length;
    el.classList.remove('is-safe', 'is-mid', 'is-weak');
    if (p.length < 8 || variety < 2) {
      el.textContent = '약함';
      el.classList.add('is-weak');
    } else if (p.length >= 10 && variety >= 3) {
      el.textContent = '안전';
      el.classList.add('is-safe');
    } else {
      el.textContent = '보통';
      el.classList.add('is-mid');
    }
  }

  function updateCropZoomLabel() {
    if (profileCropZoomPct && profileCropZoom) profileCropZoomPct.textContent = String(profileCropZoom.value);
  }

  function fitCropCanvasToStage() {
    if (!profileCropCanvas || !profileCropStage) return;
    const d = Math.max(200, Math.round(profileCropStage.clientWidth || 320));
    profileCropCanvas.width = d;
    profileCropCanvas.height = d;
  }

  function drawCropPreview() {
    if (!cropImg || !profileCropCanvas) return;
    const ctx = profileCropCanvas.getContext('2d');
    const W = profileCropCanvas.width;
    const H = profileCropCanvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 4;
    const iw = cropImg.naturalWidth;
    const ih = cropImg.naturalHeight;
    const rot = cropRotation;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const rw = iw * cos + ih * sin;
    const rh = iw * sin + ih * cos;
    const zoom = Number(profileCropZoom?.value || 100) / 100;
    const scaleCover = (2 * r) / Math.min(rw, rh);
    const s = scaleCover * zoom;

    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx + cropPanX, cy + cropPanY);
    ctx.rotate(rot);
    ctx.drawImage(cropImg, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
    ctx.restore();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i += 1) {
      const g = (2 * r * i) / 3;
      const x0 = cx - r + g;
      ctx.beginPath();
      ctx.moveTo(x0, cy - r);
      ctx.lineTo(x0, cy + r);
      ctx.stroke();
      const y0 = cy - r + g;
      ctx.beginPath();
      ctx.moveTo(cx - r, y0);
      ctx.lineTo(cx + r, y0);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function exportProfileCrop() {
    if (!cropImg || !profileCropCanvas) return '';
    const W = profileCropCanvas.width;
    const H = profileCropCanvas.height;
    const r = Math.min(W, H) / 2 - 4;
    const OUT = 512;
    const R = OUT / 2 - 2;
    const cx = OUT / 2;
    const cy = OUT / 2;
    const k = R / r;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    const iw = cropImg.naturalWidth;
    const ih = cropImg.naturalHeight;
    const rot = cropRotation;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const rw = iw * cos + ih * sin;
    const rh = iw * sin + ih * cos;
    const zoom = Number(profileCropZoom?.value || 100) / 100;
    const scaleCover = (2 * R) / Math.min(rw, rh);
    const s = scaleCover * zoom;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx + cropPanX * k, cy + cropPanY * k);
    ctx.rotate(rot);
    ctx.drawImage(cropImg, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.88);
  }

  function closeProfileCropEditor(revokePending) {
    if (profileCropModal) profileCropModal.hidden = true;
    if (revokePending && pendingCropObjectUrl) {
      try {
        URL.revokeObjectURL(pendingCropObjectUrl);
      } catch (_) {
        /* ignore */
      }
      pendingCropObjectUrl = null;
    }
    cropImg = null;
    cropDragging = false;
  }

  function openProfileCropEditor(objectUrl) {
    const img = new Image();
    img.onload = () => {
      cropImg = img;
      cropPanX = 0;
      cropPanY = 0;
      cropRotation = 0;
      if (profileCropZoom) profileCropZoom.value = '100';
      updateCropZoomLabel();
      fitCropCanvasToStage();
      drawCropPreview();
      if (profileCropModal) profileCropModal.hidden = false;
      profileCropCancel?.focus();
    };
    img.onerror = () => {
      window.alert('이미지를 불러올 수 없습니다.');
      if (objectUrl === pendingCropObjectUrl) {
        try {
          URL.revokeObjectURL(pendingCropObjectUrl);
        } catch (_) {
          /* ignore */
        }
        pendingCropObjectUrl = null;
      }
    };
    img.src = objectUrl;
  }

  const nicknameFeedbackEl = document.getElementById('nickname-check-feedback');
  const useridFeedbackEl = document.getElementById('userid-check-feedback');
  const checkNicknameBtn = document.getElementById('check-nickname');
  const checkUseridBtn = document.getElementById('check-userid');

  /** 현재 문자열 기준 서버 확인으로 사용 승인된 값(null이면 미승인) */
  let nicknameApprovedFor = null;
  let usernameApprovedFor = null;

  function clearCheckFeedback(el) {
    if (!el) return;
    el.textContent = '';
    el.classList.remove('is-ok', 'is-warn');
  }

  function setCheckFeedback(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-ok', 'is-warn');
    if (kind === 'ok') el.classList.add('is-ok');
    if (kind === 'warn') el.classList.add('is-warn');
  }

  function syncSignupNextButton() {
    if (!signupNext || signupStep !== 1) return;
    signupNext.disabled = false;
  }

  function resetSignupFlow() {
    profileCropContext = 'signup';
    selectedCharacterIds = new Set();
    nicknameApprovedFor = null;
    usernameApprovedFor = null;
    signupStepPassToken = '';
    croppedProfileDataUrl = null;
    closeProfileCropEditor(true);
    clearSignupStep1Alert();
    resetRecaptchaWidget();
    clearCheckFeedback(nicknameFeedbackEl);
    clearCheckFeedback(useridFeedbackEl);
    if (nicknameInput) nicknameInput.value = '';
    if (useridInput) useridInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (password2Input) password2Input.value = '';
    if (profileFile) profileFile.value = '';
    if (profilePreview) {
      profilePreview.innerHTML = '<span class="profile-placeholder-text">프로필</span>';
    }
    if (profilePreviewUrl) {
      try {
        URL.revokeObjectURL(profilePreviewUrl);
      } catch (_) {
        /* ignore */
      }
      profilePreviewUrl = null;
    }
    syncPasswordMatchFeedback();
    syncPasswordStrengthBadge();
    if (deferCheckbox) deferCheckbox.checked = false;
    if (characterLoadError) {
      characterLoadError.hidden = true;
      characterLoadError.textContent = '';
    }
    setSignupStep(1);
    void loadSignupCaptcha();
  }

  async function openModal() {
    if (!modal) return;
    await refreshPublicRuntimeConfig();
    if (loginModal && !loginModal.hidden) closeLoginModal();
    if (ownedCharactersModal && !ownedCharactersModal.hidden) closeOwnedCharactersModal();
    resetSignupFlow();
    modal.hidden = false;
    refreshBodyScrollLock();
    signupNext?.focus();
  }

  function closeModal() {
    if (!modal) return;
    resetSignupFlow();
    modal.hidden = true;
    refreshBodyScrollLock();
    openSignup?.focus();
  }

  openSignup?.addEventListener('click', () => {
    openModal();
  });
  closeBackdropEls?.forEach((el) => el.addEventListener('click', closeModal));

  modalBack?.addEventListener('click', () => {
    if (!modal) return;
    if (signupStep === 2) {
      signupStepPassToken = '';
      resetRecaptchaWidget();
      setSignupStep(1);
      void loadSignupCaptcha();
      clearSignupStep1Alert();
      modalBack?.focus();
      return;
    }
    closeModal();
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  /* ----- 로그인 · 세션 헤더 ----- */
  const loginModal = document.getElementById('login-modal');
  const openLoginBtn = document.getElementById('open-login');
  const loginModalCloseBtn = document.getElementById('login-modal-close');
  const loginForm = document.getElementById('login-form');
  const loginUsernameEl = document.getElementById('login-username');
  const loginPasswordEl = document.getElementById('login-password');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginFormErrorEl = document.getElementById('login-form-error');
  const headerActionsSlot = document.getElementById('header-actions-slot');
  const headerGuest = document.getElementById('header-actions-guest');
  const headerLogged = document.getElementById('header-actions-logged');
  const headerUserAvatarImg = document.getElementById('header-user-avatar');
  const headerUserAvatarPh = document.getElementById('header-user-avatar-ph');
  const headerUserNicknameEl = document.getElementById('header-user-nickname');
  const headerLogoutBtn = document.getElementById('header-logout');
  const headerOpenMypage = document.getElementById('header-open-mypage');
  const mypageProfilePreview = document.getElementById('mypage-profile-preview');
  const mypageProfileFile = document.getElementById('mypage-profile-file');
  const mypageProfileTrigger = document.getElementById('mypage-profile-file-trigger');
  const mypageNicknameInput = document.getElementById('mypage-nickname');
  const mypageCheckNicknameBtn = document.getElementById('mypage-check-nickname');
  const mypageNicknameFeedbackEl = document.getElementById('mypage-nickname-feedback');
  const mypageProfileApply = document.getElementById('mypage-profile-apply');
  const mypageOwnedGrid = document.getElementById('mypage-owned-grid');
  const mypageOwnedEmpty = document.getElementById('mypage-owned-empty');
  const mypageOwnedGridWrap = document.getElementById('mypage-owned-grid-wrap');
  const mypageOwnedUpdateOpen = document.getElementById('mypage-owned-update-open');
  const ownedCharactersModal = document.getElementById('owned-characters-modal');
  const ownedUpdateGrid = document.getElementById('owned-update-character-grid');
  const ownedModalScroll = ownedCharactersModal?.querySelector('.owned-characters-modal-scroll');
  const ownedUpdateForm = document.getElementById('owned-update-form');
  const ownedUpdateSave = document.getElementById('owned-update-save');
  const ownedUpdateCancel = document.getElementById('owned-update-cancel');
  const ownedUpdateError = document.getElementById('owned-update-error');

  let ownedUpdateSelection = new Set();

  function refreshBodyScrollLock() {
    const lock =
      (profileCropModal && !profileCropModal.hidden) ||
      (ownedCharactersModal && !ownedCharactersModal.hidden) ||
      (loginModal && !loginModal.hidden) ||
      (modal && !modal.hidden);
    document.body.style.overflow = lock ? 'hidden' : '';
  }

  function closeOwnedCharactersModal() {
    if (!ownedCharactersModal) return;
    ownedCharactersModal.hidden = true;
    if (ownedUpdateError) {
      ownedUpdateError.hidden = true;
      ownedUpdateError.textContent = '';
    }
    refreshBodyScrollLock();
    mypageOwnedUpdateOpen?.focus();
  }

  function renderMypageProfilePreviewFromSrc(src) {
    if (!mypageProfilePreview) return;
    if (src && /^data:image\//.test(src)) {
      mypageProfilePreview.innerHTML = '';
      const imgEl = document.createElement('img');
      imgEl.src = src;
      imgEl.alt = '프로필';
      mypageProfilePreview.appendChild(imgEl);
    } else {
      mypageProfilePreview.innerHTML = '<span class="profile-placeholder-text">프로필</span>';
    }
  }

  function clearMypageNicknameFeedback() {
    clearCheckFeedback(mypageNicknameFeedbackEl);
  }

  function syncMypageApplyButton() {
    if (!mypageProfileApply) return;
    const nick = mypageNicknameInput?.value.trim() || '';
    const nickChanged = nick !== mypageBaselineNickname;
    const nLen = nicknameCharCount(nick);
    const lenOk = nLen >= NICKNAME_LEN_MIN && nLen <= NICKNAME_LEN_MAX;
    const nickOk = !nickChanged || (mypageNicknameApprovedFor === nick && lenOk);
    const imageChanged =
      mypagePendingProfileDataUrl !== null && mypagePendingProfileDataUrl !== mypageBaselineProfileImage;

    const nickBranchOk = nickChanged && nickOk && lenOk;
    mypageProfileApply.disabled = !(imageChanged || nickBranchOk);
  }

  async function loadMypageProfileForm() {
    if (!mypageProfilePreview || !mypageNicknameInput) return;
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!data || !data.ok || !isSessionUser(data.user)) {
        setActiveBoard('main');
        return;
      }
      const u = data.user;
      mypageSessionUserId = u.id;
      mypageBaselineNickname = u.nickname || '';
      mypageBaselineProfileImage = typeof u.profileImage === 'string' ? u.profileImage : '';
      mypageNicknameApprovedFor = null;
      mypagePendingProfileDataUrl = null;

      mypageNicknameInput.value = mypageBaselineNickname;
      renderMypageProfilePreviewFromSrc(mypageBaselineProfileImage);
      clearMypageNicknameFeedback();
      syncMypageApplyButton();
    } catch {
      setActiveBoard('main');
    }
  }

  function setMypageTab(tabId) {
    document.querySelectorAll('.mypage-nav-btn[data-mypage-tab]').forEach((btn) => {
      const on = btn.dataset.mypageTab === tabId;
      btn.classList.toggle('is-active', on);
    });
    document.querySelectorAll('.mypage-tab-panel[data-mypage-panel]').forEach((panel) => {
      const on = panel.dataset.mypagePanel === tabId;
      panel.hidden = !on;
    });
    if (tabId === 'characters') void refreshMypageOwnedList();
  }

  document.querySelectorAll('.mypage-nav-btn[data-mypage-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setMypageTab(btn.dataset.mypageTab || 'profile'));
  });

  headerOpenMypage?.addEventListener('click', () => {
    setActiveBoard('mypage');
    setMypageTab('profile');
    window.scrollTo(0, 0);
  });

  mypageNicknameInput?.addEventListener('input', () => {
    const v = mypageNicknameInput.value.trim();
    if (mypageNicknameApprovedFor !== null && v !== mypageNicknameApprovedFor) {
      mypageNicknameApprovedFor = null;
    }
    clearMypageNicknameFeedback();
    syncMypageApplyButton();
  });

  mypageCheckNicknameBtn?.addEventListener('click', async () => {
    const nickname = mypageNicknameInput?.value.trim() || '';
    if (!nickname) {
      mypageNicknameApprovedFor = null;
      setCheckFeedback(mypageNicknameFeedbackEl, '닉네임을 입력해 주세요.', 'warn');
      syncMypageApplyButton();
      return;
    }
    const nLen = nicknameCharCount(nickname);
    if (nLen < NICKNAME_LEN_MIN || nLen > NICKNAME_LEN_MAX) {
      mypageNicknameApprovedFor = null;
      setCheckFeedback(
        mypageNicknameFeedbackEl,
        `닉네임은 ${NICKNAME_LEN_MIN}~${NICKNAME_LEN_MAX}자로 입력해 주세요.`,
        'warn'
      );
      syncMypageApplyButton();
      return;
    }

    if (!mypageSessionUserId) {
      await loadMypageProfileForm();
    }
    if (!mypageSessionUserId) {
      mypageNicknameApprovedFor = null;
      setCheckFeedback(mypageNicknameFeedbackEl, '로그인 상태를 확인할 수 없습니다.', 'warn');
      syncMypageApplyButton();
      return;
    }
    try {
      const params = new URLSearchParams({ nickname, excludeUserId: mypageSessionUserId });
      const res = await fetch(`/api/users/check?${params}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        mypageNicknameApprovedFor = null;
        setCheckFeedback(mypageNicknameFeedbackEl, data.error || '확인 중 오류가 발생했습니다.', 'warn');
        syncMypageApplyButton();
        return;
      }
      if (data.nicknameAvailable) {
        mypageNicknameApprovedFor = nickname;
        setCheckFeedback(mypageNicknameFeedbackEl, '사용 가능한 닉네임입니다.', 'ok');
      } else {
        mypageNicknameApprovedFor = null;
        setCheckFeedback(mypageNicknameFeedbackEl, '중복된 닉네임입니다.', 'warn');
      }
    } catch (e) {
      mypageNicknameApprovedFor = null;
      setCheckFeedback(mypageNicknameFeedbackEl, e instanceof Error ? e.message : String(e), 'warn');
    }
    syncMypageApplyButton();
  });

  mypageProfileTrigger?.addEventListener('click', () => mypageProfileFile?.click());

  mypageProfileFile?.addEventListener('change', () => {
    profileCropContext = 'mypage';
    const file = mypageProfileFile.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      mypageProfileFile.value = '';
      window.alert('이미지 파일만 선택할 수 있습니다.');
      return;
    }
    if (pendingCropObjectUrl) {
      try {
        URL.revokeObjectURL(pendingCropObjectUrl);
      } catch (_) {
        /* ignore */
      }
      pendingCropObjectUrl = null;
    }
    pendingCropObjectUrl = URL.createObjectURL(file);
    openProfileCropEditor(pendingCropObjectUrl);
    mypageProfileFile.value = '';
  });

  mypageProfileApply?.addEventListener('click', async () => {
    const nick = mypageNicknameInput?.value.trim() || '';
    const nickWillSend = nick !== mypageBaselineNickname && mypageNicknameApprovedFor === nick;
    const imageWillSend =
      mypagePendingProfileDataUrl !== null && mypagePendingProfileDataUrl !== mypageBaselineProfileImage;

    const payload = {};
    if (nickWillSend) payload.nickname = nick;
    if (imageWillSend) payload.profileImage = mypagePendingProfileDataUrl;

    if (Object.keys(payload).length === 0) return;

    mypageProfileApply.disabled = true;
    try {
      const data = await apiJson('/api/me', {
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (isSessionUser(data.user)) {
        renderLoggedInHeader(data.user);
        mypageBaselineNickname = data.user.nickname || '';
        mypageBaselineProfileImage =
          typeof data.user.profileImage === 'string' ? data.user.profileImage : '';
        mypagePendingProfileDataUrl = null;
        mypageNicknameApprovedFor = null;
        mypageNicknameInput.value = mypageBaselineNickname;
        renderMypageProfilePreviewFromSrc(mypageBaselineProfileImage);
        clearMypageNicknameFeedback();
        syncMypageApplyButton();
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
      syncMypageApplyButton();
    }
  });

  function showLoginFormError(text) {
    if (!loginFormErrorEl) return;
    loginFormErrorEl.textContent = text;
    loginFormErrorEl.hidden = false;
  }

  function clearLoginFormError() {
    if (!loginFormErrorEl) return;
    loginFormErrorEl.textContent = '';
    loginFormErrorEl.hidden = true;
  }

  function isSessionUser(obj) {
    return !!(obj && typeof obj === 'object' && typeof obj.id === 'string' && obj.id.length > 0);
  }

  /** CSS 뮤텍스: 게스트·로그인 UI가 동시에 flex 로 잡히지 않도록 */
  function setHeaderActionsSlotMode(loggedIn) {
    if (!headerActionsSlot) return;
    headerActionsSlot.classList.toggle('is-guest', !loggedIn);
    headerActionsSlot.classList.toggle('is-user', loggedIn);
    headerActionsSlot.dataset.authSlot = loggedIn ? 'user' : 'guest';
  }

  function renderLoggedOutHeader() {
    mypageSessionUserId = '';
    setHeaderActionsSlotMode(false);
    if (headerGuest) {
      headerGuest.hidden = false;
      headerGuest.removeAttribute('aria-hidden');
    }
    if (headerLogged) {
      headerLogged.hidden = true;
      headerLogged.setAttribute('aria-hidden', 'true');
    }
    if (headerUserAvatarImg) {
      headerUserAvatarImg.hidden = true;
      headerUserAvatarImg.removeAttribute('src');
      headerUserAvatarImg.alt = '';
    }
    if (headerUserAvatarPh) headerUserAvatarPh.hidden = false;
  }

  function renderLoggedInHeader(user) {
    if (!isSessionUser(user)) {
      renderLoggedOutHeader();
      return;
    }
    setHeaderActionsSlotMode(true);
    if (headerGuest) {
      headerGuest.hidden = true;
      headerGuest.setAttribute('aria-hidden', 'true');
    }
    if (headerLogged) {
      headerLogged.hidden = false;
      headerLogged.removeAttribute('aria-hidden');
    }
    if (headerUserNicknameEl) headerUserNicknameEl.textContent = user.nickname || '—';
    mypageSessionUserId = user.id;

    const imgSrc = typeof user.profileImage === 'string' ? user.profileImage : '';
    if (imgSrc && /^data:image\//.test(imgSrc)) {
      if (headerUserAvatarImg) {
        headerUserAvatarImg.src = imgSrc;
        headerUserAvatarImg.alt = `${user.nickname || '사용자'} 프로필`;
        headerUserAvatarImg.hidden = false;
      }
      if (headerUserAvatarPh) headerUserAvatarPh.hidden = true;
    } else {
      if (headerUserAvatarImg) {
        headerUserAvatarImg.hidden = true;
        headerUserAvatarImg.removeAttribute('src');
        headerUserAvatarImg.alt = '';
      }
      if (headerUserAvatarPh) headerUserAvatarPh.hidden = false;
    }
  }

  async function refreshSessionHeader() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok && isSessionUser(data.user)) renderLoggedInHeader(data.user);
      else renderLoggedOutHeader();
    } catch {
      renderLoggedOutHeader();
    }
  }

  function openLoginModal() {
    if (!loginModal) return;
    clearLoginFormError();
    if (ownedCharactersModal && !ownedCharactersModal.hidden) closeOwnedCharactersModal();
    loginModal.hidden = false;
    refreshBodyScrollLock();
    loginUsernameEl?.focus();
  }

  function closeLoginModal() {
    if (!loginModal) return;
    loginModal.hidden = true;
    refreshBodyScrollLock();
    if (signupModalShows()) return;
    openLoginBtn?.focus();
  }

  function signupModalShows() {
    return modal ? !modal.hidden : false;
  }

  loginModalCloseBtn?.addEventListener('click', closeLoginModal);
  loginModal?.querySelectorAll('[data-close-login-modal]').forEach((el) => {
    el.addEventListener('click', closeLoginModal);
  });
  loginModal?.addEventListener('click', (e) => {
    if (e.target === loginModal) closeLoginModal();
  });

  openLoginBtn?.addEventListener('click', () => openLoginModal());

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearLoginFormError();
    const username = loginUsernameEl?.value.trim() || '';
    const password = loginPasswordEl?.value || '';
    if (!username || !password) {
      showLoginFormError('아이디와 비밀번호를 입력해 주세요.');
      return;
    }

    loginSubmitBtn.disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showLoginFormError(data.error || `로그인 실패 (${res.status})`);
        return;
      }
      if (isSessionUser(data.user)) renderLoggedInHeader(data.user);
      else await refreshSessionHeader();
      loginForm.reset();
      closeLoginModal();
    } finally {
      loginSubmitBtn.disabled = false;
    }
  });

  headerLogoutBtn?.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } finally {
      renderLoggedOutHeader();
      openLoginBtn?.focus();
    }
  });

  window.addEventListener('load', () => {
    refreshSessionHeader();
    refreshPublicRuntimeConfig();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (profileCropModal && !profileCropModal.hidden) {
      onProfileCropCancelClick();
      e.preventDefault();
      return;
    }
    if (ownedCharactersModal && !ownedCharactersModal.hidden) {
      closeOwnedCharactersModal();
      e.preventDefault();
      return;
    }
    if (loginModal && !loginModal.hidden) {
      closeLoginModal();
      return;
    }
    if (modal && !modal.hidden) closeModal();
  });

  profileTrigger?.addEventListener('click', () => profileFile?.click());

  function wirePwToggle(btn, input) {
    if (!btn || !input) return;
    const eyeOpen = btn.querySelector('.pw-eye-open');
    const eyeShut = btn.querySelector('.pw-eye-shut');
    const hideLabel = input.id === 'password2' ? '비밀번호 확인란 숨기기' : '비밀번호 숨기기';
    const showLabel = input.id === 'password2' ? '비밀번호 확인란 표시' : '비밀번호 표시';
    btn.addEventListener('click', () => {
      const toText = input.type === 'password';
      input.type = toText ? 'text' : 'password';
      btn.setAttribute('aria-pressed', toText ? 'true' : 'false');
      btn.setAttribute('aria-label', toText ? hideLabel : showLabel);
      if (eyeOpen && eyeShut) {
        eyeOpen.hidden = !toText;
        eyeShut.hidden = toText;
      }
    });
  }
  wirePwToggle(passwordVisibilityBtn, passwordInput);
  wirePwToggle(password2VisibilityBtn, password2Input);

  profileFile?.addEventListener('change', () => {
    profileCropContext = 'signup';
    const file = profileFile.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      profileFile.value = '';
      window.alert('이미지 파일만 선택할 수 있습니다.');
      return;
    }
    if (pendingCropObjectUrl) {
      try {
        URL.revokeObjectURL(pendingCropObjectUrl);
      } catch (_) {
        /* ignore */
      }
      pendingCropObjectUrl = null;
    }
    pendingCropObjectUrl = URL.createObjectURL(file);
    openProfileCropEditor(pendingCropObjectUrl);
    profileFile.value = '';
  });

  function onProfileCropCancelClick() {
    closeProfileCropEditor(true);
  }
  profileCropCancel?.addEventListener('click', onProfileCropCancelClick);
  profileCropBackdrop?.addEventListener('click', onProfileCropCancelClick);

  profileCropConfirm?.addEventListener('click', () => {
    if (!cropImg) return;
    try {
      const dataUrl = exportProfileCrop();
      if (pendingCropObjectUrl) {
        try {
          URL.revokeObjectURL(pendingCropObjectUrl);
        } catch (_) {
          /* ignore */
        }
        pendingCropObjectUrl = null;
      }

      if (profileCropContext === 'mypage') {
        mypagePendingProfileDataUrl = dataUrl;
        const prev = mypageProfilePreview;
        if (prev) {
          prev.innerHTML = '';
          const imgEl = document.createElement('img');
          imgEl.src = dataUrl;
          imgEl.alt = '프로필 미리보기';
          prev.appendChild(imgEl);
        }
        syncMypageApplyButton();
        closeProfileCropEditor(false);
        return;
      }

      croppedProfileDataUrl = dataUrl;
      if (profilePreview) {
        profilePreview.innerHTML = '';
        const imgEl = document.createElement('img');
        imgEl.src = croppedProfileDataUrl;
        imgEl.alt = '프로필 미리보기';
        profilePreview.appendChild(imgEl);
      }
      closeProfileCropEditor(false);
      clearSignupStep1Alert();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  });

  profileCropZoom?.addEventListener('input', () => {
    updateCropZoomLabel();
    drawCropPreview();
  });

  profileCropRotate?.addEventListener('click', () => {
    cropRotation = (cropRotation + Math.PI / 2) % (Math.PI * 2);
    drawCropPreview();
  });

  function endCropDrag(e) {
    if (!cropDragging) return;
    cropDragging = false;
    try {
      profileCropCanvas?.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  }

  profileCropCanvas?.addEventListener('pointerdown', (e) => {
    if (!cropImg) return;
    cropDragging = true;
    cropLastPointerX = e.clientX;
    cropLastPointerY = e.clientY;
    try {
      profileCropCanvas.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  });
  profileCropCanvas?.addEventListener('pointermove', (e) => {
    if (!cropDragging || !cropImg) return;
    const dx = e.clientX - cropLastPointerX;
    const dy = e.clientY - cropLastPointerY;
    cropLastPointerX = e.clientX;
    cropLastPointerY = e.clientY;
    cropPanX += dx;
    cropPanY += dy;
    drawCropPreview();
  });
  profileCropCanvas?.addEventListener('pointerup', endCropDrag);
  profileCropCanvas?.addEventListener('pointercancel', endCropDrag);

  window.addEventListener('resize', () => {
    if (!profileCropModal || profileCropModal.hidden || !cropImg) return;
    fitCropCanvasToStage();
    drawCropPreview();
  });

  async function apiJson(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data && data.error ? data.error : `요청 실패 (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  nicknameInput?.addEventListener('input', () => {
    clearSignupStep1Alert();
    const v = nicknameInput.value.trim();
    if (nicknameApprovedFor !== null && v !== nicknameApprovedFor) nicknameApprovedFor = null;
    clearCheckFeedback(nicknameFeedbackEl);
    syncSignupNextButton();
  });

  useridInput?.addEventListener('input', () => {
    clearSignupStep1Alert();
    const v = useridInput.value.trim();
    if (usernameApprovedFor !== null && v !== usernameApprovedFor) usernameApprovedFor = null;
    clearCheckFeedback(useridFeedbackEl);
    syncSignupNextButton();
  });

  checkNicknameBtn?.addEventListener('click', async () => {
    clearSignupStep1Alert();
    const nickname = nicknameInput?.value.trim() || '';
    if (!nickname) {
      nicknameApprovedFor = null;
      setCheckFeedback(nicknameFeedbackEl, '닉네임을 입력해 주세요.', 'warn');
      syncSignupNextButton();
      return;
    }
    const nLen = nicknameCharCount(nickname);
    if (nLen < NICKNAME_LEN_MIN || nLen > NICKNAME_LEN_MAX) {
      nicknameApprovedFor = null;
      setCheckFeedback(
        nicknameFeedbackEl,
        `닉네임은 ${NICKNAME_LEN_MIN}~${NICKNAME_LEN_MAX}자로 입력해 주세요.`,
        'warn'
      );
      syncSignupNextButton();
      return;
    }
    try {
      const res = await fetch(`/api/users/check?${new URLSearchParams({ nickname })}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        nicknameApprovedFor = null;
        setCheckFeedback(nicknameFeedbackEl, data.error || '확인 중 오류가 발생했습니다.', 'warn');
        syncSignupNextButton();
        return;
      }
      if (data.nicknameAvailable) {
        nicknameApprovedFor = nickname;
        setCheckFeedback(nicknameFeedbackEl, '사용 가능한 닉네임입니다.', 'ok');
      } else {
        nicknameApprovedFor = null;
        setCheckFeedback(nicknameFeedbackEl, '중복된 닉네임입니다.', 'warn');
      }
    } catch (e) {
      nicknameApprovedFor = null;
      setCheckFeedback(
        nicknameFeedbackEl,
        e instanceof Error ? e.message : String(e),
        'warn'
      );
    }
    syncSignupNextButton();
  });

  checkUseridBtn?.addEventListener('click', async () => {
    clearSignupStep1Alert();
    const username = useridInput?.value.trim() || '';
    if (!username) {
      usernameApprovedFor = null;
      setCheckFeedback(useridFeedbackEl, '아이디를 입력해 주세요.', 'warn');
      syncSignupNextButton();
      return;
    }
    if (!USERNAME_RE_CLIENT.test(username)) {
      usernameApprovedFor = null;
      setCheckFeedback(
        useridFeedbackEl,
        '아이디는 영문·숫자·밑줄만 사용하고 8~20자로 입력해 주세요.',
        'warn'
      );
      syncSignupNextButton();
      return;
    }
    try {
      const res = await fetch(`/api/users/check?${new URLSearchParams({ username })}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        usernameApprovedFor = null;
        setCheckFeedback(useridFeedbackEl, data.error || '확인 중 오류가 발생했습니다.', 'warn');
        syncSignupNextButton();
        return;
      }
      if (data.usernameAvailable) {
        usernameApprovedFor = username;
        setCheckFeedback(useridFeedbackEl, '사용 가능한 아이디 입니다', 'ok');
      } else {
        usernameApprovedFor = null;
        setCheckFeedback(useridFeedbackEl, '중복된 아이디입니다.', 'warn');
      }
    } catch (e) {
      usernameApprovedFor = null;
      setCheckFeedback(useridFeedbackEl, e instanceof Error ? e.message : String(e), 'warn');
    }
    syncSignupNextButton();
  });

  passwordInput?.addEventListener('input', () => {
    clearSignupStep1Alert();
    syncSignupNextButton();
    syncPasswordMatchFeedback();
    syncPasswordStrengthBadge();
  });
  password2Input?.addEventListener('input', () => {
    clearSignupStep1Alert();
    syncSignupNextButton();
    syncPasswordMatchFeedback();
  });

  signupCaptchaAnswer?.addEventListener('input', () => {
    clearSignupStep1Alert();
  });

  signupCaptchaRefresh?.addEventListener('click', () => {
    void loadSignupCaptcha();
  });

  const MAX_PROFILE_DATA_URL_LENGTH = 600_000;

  function ensureCharactersLoaded() {
    if (charactersCache !== null) return Promise.resolve(charactersCache);
    if (charactersLoadPromise) return charactersLoadPromise;
    charactersLoadPromise = apiJson('/api/characters')
      .then((data) => {
        charactersCache = Array.isArray(data.characters) ? data.characters : [];
        return charactersCache;
      })
      .finally(() => {
        charactersLoadPromise = null;
      });
    return charactersLoadPromise;
  }

  /**
   * 캐릭터 선택 그리드를 렌더링한다.
   * getSelection/setSelection 콜백으로 Set 참조를 런타임에 읽어
   * openOwnedCharactersModal 재호출 등으로 Set이 교체돼도 올바른 Set을 조작한다.
   */
  function renderCharacterPickerInto(gridEl, list, getSelection) {
    if (!gridEl) return;
    gridEl.innerHTML = '';
    list.forEach((c) => {
      const id = String(c.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-picker-btn';
      btn.dataset.characterId = id;
      btn.setAttribute('role', 'listitem');

      const thumb = document.createElement('div');
      thumb.className = 'character-thumb';
      const img = document.createElement('img');
      img.alt = c.name || '캐릭터';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = c.imageUrl || `/api/characters/${encodeURIComponent(id)}/image`;

      const nameEl = document.createElement('div');
      nameEl.className = 'character-name';
      nameEl.textContent = c.name || '';

      thumb.appendChild(img);
      btn.appendChild(thumb);
      btn.appendChild(nameEl);

      const sync = () => {
        btn.classList.toggle('is-selected', getSelection().has(id));
      };
      sync();

      btn.addEventListener('click', () => {
        const sel = getSelection();
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
        sync();
      });

      gridEl.appendChild(btn);
    });
  }

  function renderCharacterGrid(list) {
    renderCharacterPickerInto(characterGrid, list, () => selectedCharacterIds);
  }

  function renderOwnedDisplayGrid(container, list) {
    if (!container) return;
    container.innerHTML = '';
    list.forEach((c) => {
      const id = String(c.id);
      const cell = document.createElement('div');
      cell.className = 'character-owned-cell';
      cell.setAttribute('role', 'listitem');

      const thumb = document.createElement('div');
      thumb.className = 'character-thumb character-thumb--readonly';
      const img = document.createElement('img');
      img.alt = c.name || '캐릭터';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = c.imageUrl || `/api/characters/${encodeURIComponent(id)}/image`;

      const nameEl = document.createElement('div');
      nameEl.className = 'character-name';
      nameEl.textContent = c.name || '';

      thumb.appendChild(img);
      cell.appendChild(thumb);
      cell.appendChild(nameEl);
      container.appendChild(cell);
    });
  }

  async function refreshMypageOwnedList() {
    if (!mypageOwnedGrid || !mypageOwnedEmpty || !mypageOwnedGridWrap) return;
    try {
      const res = await fetch('/api/me/owned-characters', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        mypageOwnedEmpty.hidden = false;
        mypageOwnedGridWrap.hidden = true;
        mypageOwnedGrid.innerHTML = '';
        return;
      }
      const list = Array.isArray(data.characters) ? data.characters : [];
      if (list.length === 0) {
        mypageOwnedEmpty.hidden = false;
        mypageOwnedGridWrap.hidden = true;
        mypageOwnedGrid.innerHTML = '';
      } else {
        mypageOwnedEmpty.hidden = true;
        mypageOwnedGridWrap.hidden = false;
        renderOwnedDisplayGrid(mypageOwnedGrid, list);
      }
    } catch {
      mypageOwnedEmpty.hidden = false;
      mypageOwnedGridWrap.hidden = true;
      mypageOwnedGrid.innerHTML = '';
    }
  }

  async function openOwnedCharactersModal() {
    if (!ownedCharactersModal || !ownedUpdateGrid) return;
    if (ownedUpdateError) {
      ownedUpdateError.hidden = true;
      ownedUpdateError.textContent = '';
    }
    try {
      const list = await ensureCharactersLoaded();
      const ownedRes = await fetch('/api/me/owned-characters', { credentials: 'include' });
      const ownedData = await ownedRes.json().catch(() => ({}));
      if (!ownedRes.ok) {
        throw new Error(ownedData.error || '보유 목록을 불러올 수 없습니다.');
      }
      ownedUpdateSelection = new Set(
        (Array.isArray(ownedData.characters) ? ownedData.characters : []).map((c) => String(c.id))
      );
      renderCharacterPickerInto(ownedUpdateGrid, list, () => ownedUpdateSelection);
      ownedCharactersModal.hidden = false;
      refreshBodyScrollLock();
      requestAnimationFrame(() => ownedModalScroll?.focus());
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  mypageOwnedUpdateOpen?.addEventListener('click', () => {
    void openOwnedCharactersModal();
  });

  document.getElementById('owned-characters-modal-close')?.addEventListener('click', () => {
    closeOwnedCharactersModal();
  });
  ownedUpdateCancel?.addEventListener('click', () => {
    closeOwnedCharactersModal();
  });
  ownedCharactersModal?.querySelectorAll('[data-close-owned-modal]').forEach((el) => {
    el.addEventListener('click', () => closeOwnedCharactersModal());
  });
  ownedCharactersModal?.addEventListener('click', (e) => {
    if (e.target === ownedCharactersModal) closeOwnedCharactersModal();
  });

  ownedUpdateSave?.addEventListener('click', async () => {
    if (ownedUpdateError) {
      ownedUpdateError.hidden = true;
      ownedUpdateError.textContent = '';
    }
    const characterIds = [...ownedUpdateSelection];
    ownedUpdateSave.disabled = true;
    try {
      const res = await fetch('/api/me/owned-characters', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `저장 실패 (${res.status})`);
      }
      closeOwnedCharactersModal();
      await refreshMypageOwnedList();
    } catch (e) {
      if (ownedUpdateError) {
        ownedUpdateError.textContent = e instanceof Error ? e.message : String(e);
        ownedUpdateError.hidden = false;
      }
    } finally {
      if (ownedUpdateSave) ownedUpdateSave.disabled = false;
    }
  });

  ownedUpdateForm?.addEventListener('submit', (e) => {
    e.preventDefault();
  });

  signupNext?.addEventListener('click', async () => {
    const err = getFirstSignupStep1ValidationError();
    if (err) {
      setSignupStep1Alert(err);
      return;
    }
    clearSignupStep1Alert();

    const captchaAnswer = signupCaptchaAnswer?.value || '';

    signupNext.disabled = true;
    try {
      const captchaRes = await fetch('/api/signup/verify-step1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captchaId: signupCaptchaId,
          captchaAnswer,
        }),
      });
      const captchaData = await captchaRes.json().catch(() => ({}));
      if (!captchaRes.ok) {
        setSignupStep1Alert(captchaData.error || '보안 문자 확인에 실패했습니다.');
        void loadSignupCaptcha();
        return;
      }
      signupStepPassToken = captchaData.stepPassToken || '';

      const list = await ensureCharactersLoaded();
      setSignupStep(2);
      try {
        await renderSignupRecaptchaOnce();
      } catch (reErr) {
        window.alert(reErr instanceof Error ? reErr.message : String(reErr));
        setSignupStep(1);
        signupStepPassToken = '';
        void loadSignupCaptcha();
        return;
      }
      renderCharacterGrid(list);
      if (characterLoadError) {
        if (list.length === 0) {
          characterLoadError.textContent =
            '등록된 캐릭터 목록이 비어 있습니다. ‘보유 캐릭터 추후 등록’에 체크하면 가입할 수 있습니다.';
          characterLoadError.hidden = false;
        } else {
          characterLoadError.hidden = true;
          characterLoadError.textContent = '';
        }
      }
      requestAnimationFrame(() => characterGridScroll?.focus());
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      signupNext.disabled = false;
    }
  });

  signupSubmit?.addEventListener('click', async () => {
    const nickname = nicknameInput?.value.trim() || '';
    const username = useridInput?.value.trim() || '';
    const password = passwordInput?.value || '';
    const password2 = password2Input?.value || '';
    const defer = Boolean(deferCheckbox?.checked);

    let recaptchaToken = '';
    if (publicCfg.recaptchaSiteKey) {
      if (recaptchaWidgetId === null || !window.grecaptcha) {
        window.alert('보안 확인을 초기화할 수 없습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.');
        return;
      }
      recaptchaToken = window.grecaptcha.getResponse(recaptchaWidgetId);
      if (!recaptchaToken) {
        window.alert('「로봇이 아닙니다」 확인을 완료해 주세요.');
        return;
      }
    }

    if (password !== password2) {
      window.alert('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      setSignupStep(1);
      return;
    }
    if (!password) {
      window.alert('비밀번호를 입력해 주세요.');
      setSignupStep(1);
      return;
    }

    if (!defer && selectedCharacterIds.size === 0) {
      window.alert('보유 캐릭터를 선택하거나,\n‘보유 캐릭터 추후 등록’에 체크해 주세요.');
      return;
    }

    if (!signupStepPassToken) {
      window.alert('1단계(보안 문자 및 정보 입력)가 완료되지 않았습니다. 이전 단계로 돌아가 다시 진행해 주세요.');
      setSignupStep(1);
      void loadSignupCaptcha();
      return;
    }

    let profileImage = croppedProfileDataUrl || null;
    if (profileImage && profileImage.length > MAX_PROFILE_DATA_URL_LENGTH) {
      window.alert('프로필 이미지 데이터가 너무 큽니다. 다른 이미지를 선택해 주세요.');
      return;
    }

    signupSubmit.disabled = true;
    try {
      const data = await apiJson('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          nickname,
          password,
          profileImage,
          characterIds: Array.from(selectedCharacterIds),
          deferOwnedCharacters: defer,
          recaptchaToken,
          stepPassToken: signupStepPassToken,
        }),
      });
      const count = typeof data.ownedCharacterCount === 'number' ? data.ownedCharacterCount : 0;
      const deferMsg = data.deferOwnedCharacters ? '(보유 캐릭터는 추후 등록 예정입니다.)' : `선택한 캐릭터 ${count}명이 저장되었습니다.`;
      window.alert(`회원가입이 완료되었습니다.\n닉네임: ${data.user.nickname}\n아이디: ${data.user.username}\n${deferMsg}`);
      closeModal();
    } catch (e) {
      if (publicCfg.recaptchaSiteKey) resetRecaptchaWidget();
      signupStepPassToken = '';
      window.alert(e instanceof Error ? e.message : String(e));
      setSignupStep(1);
      void loadSignupCaptcha();
    } finally {
      signupSubmit.disabled = false;
    }
  });

})();
