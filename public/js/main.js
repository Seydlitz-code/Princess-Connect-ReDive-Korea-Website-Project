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

  const CLAN_SUB_BOARDS = new Set(['clan-semi', 'clan-fullauto']);

  const CLAN_SUB_LABELS = {
    'clan-semi': '세미오토',
    'clan-fullauto': '플오토',
  };

  function setActiveBoard(boardId) {
    const mappedBoardId = boardId === 'clan' ? 'clan-fullauto' : boardId;
    const isClanSub = CLAN_SUB_BOARDS.has(mappedBoardId);
    const panelBoardId = isClanSub ? 'clan' : mappedBoardId;

    const subTitleEl = document.getElementById('clan-board-subtitle');
    if (subTitleEl) {
      subTitleEl.textContent = isClanSub ? `- ${CLAN_SUB_LABELS[mappedBoardId] || ''}` : '';
    }

    links.forEach((btn) => {
      const on = btn.dataset.board === mappedBoardId || (isClanSub && btn.dataset.board === 'clan-fullauto');
      btn.classList.toggle('is-active', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    document.querySelectorAll('.clan-dropdown-item').forEach((item) => {
      const on = item.dataset.board === mappedBoardId;
      item.classList.toggle('is-active', on);
    });

    panels.forEach((panel) => {
      const match = panel.dataset.boardPanel === panelBoardId;
      panel.hidden = !match;
      panel.classList.toggle('is-visible', match);
    });

    document.body.classList.toggle('is-mypage-route', mappedBoardId === 'mypage');

    let activeBtn = links.find((b) => b.dataset.board === mappedBoardId);
    if (!activeBtn && isClanSub) {
      activeBtn = links.find((b) => b.dataset.board === 'clan-fullauto');
    }
    requestAnimationFrame(() => moveUnderline(activeBtn));

    if (mappedBoardId === 'mypage') {
      queueMicrotask(() => {
        loadMypageProfileForm();
      });
    }
    if (isClanSub || mappedBoardId === 'clan') {
      if (window.location.pathname !== '/') {
        history.replaceState({ route: 'clan-board' }, '', '/');
      }
      queueMicrotask(() => {
        loadClanBoardPosts();
      });
    }
  }

  links.forEach((btn) => {
    btn.addEventListener('click', () => setActiveBoard(btn.dataset.board));
  });

  document.querySelectorAll('.clan-dropdown-item').forEach((btn) => {
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

  const USERNAME_RE_CLIENT = /^[a-zA-Z]{8,20}$/;
  /** 한글·영문·일본어(히라가나·가타카나·반각 가타카나·한자 등) */
  const NICKNAME_CHARS_RE =
    /^[\uAC00-\uD7A3\u3131-\u318Ea-zA-Z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF66-\uFF9F]+$/;
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

  function syncSignupModalBackButton() {
    if (!modalBack) return;
    if (signupStep === 1) {
      modalBack.innerHTML = '취소';
      modalBack.setAttribute('aria-label', '취소');
    } else {
      modalBack.innerHTML = '<span aria-hidden="true">←</span> 뒤로 가기';
      modalBack.setAttribute('aria-label', '뒤로 가기');
    }
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
    syncSignupModalBackButton();
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
    if (!NICKNAME_CHARS_RE.test(nickname)) {
      return '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.';
    }
    if (nicknameApprovedFor !== nickname) return '닉네임 중복 확인을 해 주세요.';

    if (!username) return '아이디를 입력해 주세요.';
    if (!USERNAME_RE_CLIENT.test(username)) {
      return '아이디는 영문만 사용하고 8~20자로 입력해 주세요.';
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
  const brandLink = document.querySelector('.brand');
  const mypageToMain = document.getElementById('mypage-to-main');
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
  const ownedUpdateCancel = document.getElementById('owned-update-cancel');
  const ownedUpdateError = document.getElementById('owned-update-error');
  const ownedUpdateSearchInput = document.getElementById('owned-update-character-search');
  const ownedUpdateSearchSubmit = document.getElementById('owned-update-character-search-submit');
  const futureMainSheet = document.getElementById('future-main-sheet');
  const adminNavGroup = document.getElementById('mypage-admin-nav-group');
  const adminSubnav = document.querySelector('[data-mypage-subnav="site"]');
  const adminToggle = document.querySelector('[data-mypage-admin-toggle="site"]');
  const futureAdminSheet = document.getElementById('future-admin-sheet');
  const futureAdminSave = document.getElementById('future-admin-save');
  const futureAdminStatus = document.getElementById('future-admin-status');
  const futureCharacterModal = document.getElementById('future-character-modal');
  const futureCharacterGrid = document.getElementById('future-character-grid');
  const futureTypeModal = document.getElementById('future-type-modal');
  const futureInfoModal = document.getElementById('future-info-modal');
  const futureInfoInput = document.getElementById('future-info-input');
  const futureInfoSave = document.getElementById('future-info-save');
  const futureInfoCancel = document.getElementById('future-info-cancel');

  let ownedUpdateSelection = new Set();
  let sessionUserRole = 'guest';
  let futureSightState = null;
  /** 메인 미래시 전용: 로그인 시 보유 캐릭터만 흑백 처리(null이면 게스트·전원 컬러) */
  let futureMainOwnedIdSet = /** @type {Set<string>|null} */ (null);
  let futureCharacterTarget = null;
  /** @type {{ kind: 'edit', monthId: string, categoryId: string, index: number } | { kind: 'pick', character: object, monthId: string, categoryId: string, index?: number } | { kind: 'pick-batch-queue', characters: object[], index: number, resolved: { character: object, type: 'limited'|'permanent'|'pass' }[], monthId: string, categoryId: string, specialSlot?: 'prize' | 'simultaneous' } | null} */
  let futureTypeContext = null;
  let futureCharacterPickSelected = null;
  /** 프라이즈 뽑기 다중 선택: characterId → character */
  let futureCharacterPickMap = new Map();
  /** 동시픽업 다중 선택: characterId → character */
  let futureCharacterSimultaneousMap = new Map();
  /** 체크박스와 동기화: 다중 선택 모드(그리드 클릭 로직이 항상 올바른 Map을 쓰도록 함) */
  let futureCharacterBulkMode = /** @type {'none' | 'prize' | 'simultaneous'} */ ('none');
  let futureInfoMonthId = null;

  const FUTURE_CATEGORIES = [
    { id: 'new', label: '신규 캐릭터' },
    { id: 'rerun', label: '복각 캐릭터' },
    { id: 'sixStar', label: '6성개화' },
    { id: 'unique1', label: '전용장비1' },
    { id: 'unique2', label: '전용장비2' },
    { id: 'event', label: '이벤트' },
  ];

  const MYPAGE_OWNED_EMPTY_DEFAULT = '보유 캐릭터를 등록하지 않았습니다.';

  /** 선택 상태는 UI(`is-selected`)가 단일 출처. Set 불일치 시에도 저장이 비지 않도록 DOM에서 수집한다. */
  function ownedUpdateSelectedIdsFromDom() {
    if (!ownedUpdateGrid) return [];
    const out = [];
    const seen = new Set();
    ownedUpdateGrid.querySelectorAll('.character-picker-btn.is-selected').forEach((btn) => {
      const id = String(btn.dataset.characterId || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out;
  }

  function refreshBodyScrollLock() {
    const lock =
      (profileCropModal && !profileCropModal.hidden) ||
      (ownedCharactersModal && !ownedCharactersModal.hidden) ||
      (futureCharacterModal && !futureCharacterModal.hidden) ||
      (futureTypeModal && !futureTypeModal.hidden) ||
      (futureInfoModal && !futureInfoModal.hidden) ||
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
    if (ownedUpdateSearchInput) ownedUpdateSearchInput.value = '';
    ownedUpdateGrid?.querySelectorAll('.character-picker-btn').forEach((btn) => {
      btn.classList.remove('character-picker-btn--filtered-out');
      btn.removeAttribute('hidden');
    });
    refreshBodyScrollLock();
    mypageOwnedUpdateOpen?.focus();
  }

  /** 검색으로 숨긴 노드도 DOM에 남기 때문에 선택 상태(Set·is-selected)가 유지된다. 숨김은 CSS `character-picker-btn--filtered-out`(display:none !important) 사용 — `hidden` 속성은 버튼의 display:flex에 무력화될 수 있음. */
  function normalizeOwnedSearchText(raw) {
    try {
      return String(raw || '')
        .normalize('NFC')
        .trim()
        .toLowerCase();
    } catch {
      return String(raw || '')
        .trim()
        .toLowerCase();
    }
  }

  function applyOwnedUpdateCharacterSearchFilter() {
    if (!ownedUpdateGrid) return;
    const q = normalizeOwnedSearchText(ownedUpdateSearchInput?.value || '');
    ownedUpdateGrid.querySelectorAll('.character-picker-btn').forEach((btn) => {
      const name = normalizeOwnedSearchText(btn.querySelector('.character-name')?.textContent || '');
      const match = !q || name.includes(q);
      btn.classList.toggle('character-picker-btn--filtered-out', !match);
      btn.removeAttribute('hidden');
    });
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
    const nickCharsOk = nick === '' || NICKNAME_CHARS_RE.test(nick);
    const nickOk = !nickChanged || (mypageNicknameApprovedFor === nick && lenOk && nickCharsOk);
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
    const adminTabSelected = tabId === 'admin-future' || tabId === 'admin-board';
    if (adminSubnav) adminSubnav.hidden = !adminTabSelected;
    if (adminToggle) adminToggle.classList.toggle('is-active', adminTabSelected);
    document.querySelectorAll('.mypage-nav-btn[data-mypage-tab]').forEach((btn) => {
      const on = btn.dataset.mypageTab === tabId;
      btn.classList.toggle('is-active', on);
    });
    document.querySelectorAll('.mypage-tab-panel[data-mypage-panel]').forEach((panel) => {
      const on = panel.dataset.mypagePanel === tabId;
      panel.hidden = !on;
    });
    if (tabId === 'characters') void refreshMypageOwnedList();
    if (tabId === 'admin-future') void loadFutureSightForAdmin();
  }

  function setAdminNavigationVisible(show) {
    if (!adminNavGroup) return;
    adminNavGroup.hidden = !show;
    if (!show && adminSubnav) adminSubnav.hidden = true;
    if (adminToggle) adminToggle.classList.toggle('is-active', show && adminSubnav && !adminSubnav.hidden);
  }

  function currentMonthNumber() {
    return new Date().getMonth() + 1;
  }

  function normalizeMonthNumber(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
  }

  function parseMonthNumber(label) {
    const m = String(label || '').match(/(\d{1,2})\s*월/);
    return m ? normalizeMonthNumber(m[1]) : null;
  }

  function addMonthsNumber(baseMonth, offset) {
    return ((baseMonth - 1 + offset) % 12) + 1;
  }

  function makeFutureMonth(index, baseMonth = currentMonthNumber()) {
    const monthNumber = addMonthsNumber(baseMonth, index);
    return {
      id: `month-${Date.now()}-${index}`,
      monthNumber,
      label: `${monthNumber}월`,
      categories: { new: [], rerun: [], sixStar: [], unique1: [], unique2: [], event: [] },
      info: '',
    };
  }

  function makeFutureSpecialGroupId() {
    return `sg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function ensureFutureState(state) {
    const src = state && typeof state === 'object' ? state : {};
    const months = Array.isArray(src.months) ? src.months : [];
    const normalized = months.map((month, idx) => {
      const categories = month.categories && typeof month.categories === 'object' ? month.categories : {};
      const monthNumber =
        normalizeMonthNumber(month.monthNumber) ||
        parseMonthNumber(month.label) ||
        addMonthsNumber(currentMonthNumber(), idx);
      const normalizeEntries = (items) =>
        (Array.isArray(items) ? items : []).map((item) => {
          let t = item.type === 'pass' ? 'pass' : item.type === 'limited' ? 'limited' : 'permanent';
          if (item.princessPass === true) t = 'pass';
          return {
            characterId: String(item.characterId || item.id || '').trim(),
            id: String(item.id || item.characterId || '').trim(),
            name: String(item.name || ''),
            imageUrl: String(item.imageUrl || ''),
            type: t,
            ...(item.prizeGacha === true ? { prizeGacha: true } : {}),
            ...(item.simultaneousRerun === true ? { simultaneousRerun: true } : {}),
            ...(typeof item.specialGroupId === 'string' && item.specialGroupId.trim().length > 0
              ? { specialGroupId: item.specialGroupId.trim().slice(0, 80) }
              : {}),
          };
        }).filter((item) => item.characterId || item.id);
      return {
        id: String(month.id || `month-${idx + 1}`),
        monthNumber,
        label: String(month.label || `${monthNumber}월`),
        categories: {
          new: normalizeEntries(categories.new),
          rerun: normalizeEntries(categories.rerun),
          sixStar: normalizeEntries(categories.sixStar),
          unique1: normalizeEntries(categories.unique1),
          unique2: normalizeEntries(categories.unique2),
          event: [...normalizeEntries(categories.event), ...normalizeEntries(categories.special)],
        },
        info: String(month.info || ''),
      };
    });
    return { version: 1, months: months.length > 0 ? normalized : [makeFutureMonth(0)] };
  }

  function futureTypeLabel(type) {
    if (type === 'pass') return '패스';
    return type === 'limited' ? '한정' : '통상';
  }

  function findFutureMonth(monthId) {
    if (!futureSightState) return null;
    return futureSightState.months.find((month) => month.id === monthId) || null;
  }

  function futurePayloadForSave() {
    const state = ensureFutureState(futureSightState);
    return {
      version: 1,
      months: state.months.map((month) => ({
        id: month.id,
        monthNumber: month.monthNumber,
        label: month.label,
        categories: Object.fromEntries(
          FUTURE_CATEGORIES.map((cat) => [
            cat.id,
            (month.categories[cat.id] || []).map((entry) => ({
              characterId: entry.characterId || entry.id,
              type: entry.type === 'pass' ? 'pass' : entry.type === 'limited' ? 'limited' : 'permanent',
              ...(entry.prizeGacha === true ? { prizeGacha: true } : {}),
              ...(entry.simultaneousRerun === true ? { simultaneousRerun: true } : {}),
              ...(typeof entry.specialGroupId === 'string' && entry.specialGroupId.trim().length > 0
                ? { specialGroupId: entry.specialGroupId.trim().slice(0, 80) }
                : {}),
            })),
          ])
        ),
        info: month.info || '',
      })),
    };
  }

  function buildFutureCharCardElement(entry, globalIndex, readonly, monthId, categoryId, ownedGrayscaleSet) {
    const showType = categoryId === 'new' || categoryId === 'rerun';
    const item = document.createElement('div');
    if (!readonly) {
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.dataset.futureAction = 'replace-character';
      item.dataset.monthId = monthId;
      item.dataset.categoryId = categoryId;
      item.dataset.index = String(globalIndex);
    }
    item.className = 'future-char-card';
    if (entry.prizeGacha && !entry.simultaneousRerun) item.classList.add('future-char-card--prize');
    if (entry.simultaneousRerun) item.classList.add('future-char-card--simultaneous-rerun');
    const cid = String(entry.characterId || entry.id || '').trim();
    if (readonly && ownedGrayscaleSet && cid && ownedGrayscaleSet.has(cid)) {
      item.classList.add('future-char-card--owned-grayscale');
    }

    const nameWrap = document.createElement('div');
    nameWrap.className = 'future-char-name';
    const nameText = document.createElement('span');
    nameText.className = 'future-char-name-text';
    nameText.textContent = entry.name || '캐릭터';
    nameWrap.appendChild(nameText);

    const img = document.createElement('img');
    img.alt = entry.name || '캐릭터';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = entry.imageUrl || `/api/characters/${encodeURIComponent(entry.characterId || entry.id)}/image`;

    item.append(nameWrap, img);

    if (showType) {
      const typ =
        entry.type === 'pass' ? 'pass' : entry.type === 'limited' ? 'limited' : 'permanent';
      const type = document.createElement(readonly ? 'span' : 'button');
      type.className = `future-type-badge is-${typ}`;
      type.textContent = futureTypeLabel(typ);
      if (!readonly) {
        type.type = 'button';
        type.dataset.futureAction = 'type';
        type.dataset.monthId = monthId;
        type.dataset.categoryId = categoryId;
        type.dataset.index = String(globalIndex);
        type.addEventListener('click', (e) => e.stopPropagation());
      }
      item.appendChild(type);
    }

    return item;
  }

  /**
   * 프라이즈·동시픽업을 specialGroupId 기준으로 나눈다(목록 순서대로, 같은 키가 연속이면 한 블록).
   * Id 없음(구 데이터)은 동일 레거시 키로 묶인다.
   */
  function segmentFutureSpecialUiGroups(list, kind) {
    const segments = [];
    const legacyKey = '__legacy__';
    list.forEach((entry, globalIndex) => {
      const prizeOnly = !!entry.prizeGacha && !entry.simultaneousRerun;
      const simultaneous = !!entry.simultaneousRerun;
      if (kind === 'prize' && !prizeOnly) return;
      if (kind === 'simultaneous' && !simultaneous) return;
      const raw = typeof entry.specialGroupId === 'string' ? entry.specialGroupId.trim() : '';
      const key = raw.length > 0 ? raw : legacyKey;
      const last = segments[segments.length - 1];
      if (!last || last.key !== key) {
        segments.push({ key, pairs: [{ entry, globalIndex }] });
      } else {
        last.pairs.push({ entry, globalIndex });
      }
    });
    return segments;
  }

  /** 일반 캐릭터 줄 + 프라이즈 가이드 + 동시픽업 블록(팝업별 추가 배치마다 블록 분리) */
  function renderFutureCategoryContent(entries, readonly, monthId, categoryId, ownedGrayscaleSet) {
    const list = Array.isArray(entries) ? entries : [];
    const stack = document.createElement('div');
    stack.className = 'future-category-stack';

    const normalLine = document.createElement('div');
    normalLine.className = 'future-char-line';
    list.forEach((entry, globalIndex) => {
      if (entry.prizeGacha || entry.simultaneousRerun) return;
      normalLine.appendChild(
        buildFutureCharCardElement(entry, globalIndex, readonly, monthId, categoryId, ownedGrayscaleSet)
      );
    });
    stack.appendChild(normalLine);

    segmentFutureSpecialUiGroups(list, 'prize').forEach((seg) => {
      const prizeLine = document.createElement('div');
      prizeLine.className = 'future-char-line future-prize-guide-line';
      for (const { entry, globalIndex } of seg.pairs) {
        prizeLine.appendChild(
          buildFutureCharCardElement(entry, globalIndex, readonly, monthId, categoryId, ownedGrayscaleSet)
        );
      }
      const guide = document.createElement('div');
      guide.className = 'future-prize-guide';
      const titleEl = document.createElement('div');
      titleEl.className = 'future-prize-guide-title';
      titleEl.textContent = '프라이즈 가이드';
      guide.appendChild(titleEl);
      guide.appendChild(prizeLine);
      stack.appendChild(guide);
    });

    segmentFutureSpecialUiGroups(list, 'simultaneous').forEach((seg) => {
      const simLine = document.createElement('div');
      simLine.className = 'future-char-line future-simultaneous-guide-line';
      for (const { entry, globalIndex } of seg.pairs) {
        simLine.appendChild(
          buildFutureCharCardElement(entry, globalIndex, readonly, monthId, categoryId, ownedGrayscaleSet)
        );
      }
      const guide = document.createElement('div');
      guide.className = 'future-simultaneous-guide';
      const titleEl = document.createElement('div');
      titleEl.className = 'future-simultaneous-guide-title';
      titleEl.textContent = '동시픽업';
      guide.appendChild(titleEl);
      guide.appendChild(simLine);
      stack.appendChild(guide);
    });

    return stack;
  }

  function renderFutureMain(state) {
    if (!futureMainSheet) return;
    const data = ensureFutureState(state);
    futureMainSheet.innerHTML = '';
    if (data.months.length === 0) {
      futureMainSheet.textContent = '등록된 미래시가 없습니다.';
      return;
    }
    const table = document.createElement('div');
    table.className = 'future-main-table';

    const header = document.createElement('div');
    header.className = 'future-main-table-row future-main-table-row--head';
    const monthHead = document.createElement('div');
    monthHead.textContent = '월';
    header.appendChild(monthHead);
    FUTURE_CATEGORIES.forEach((cat) => {
      const cell = document.createElement('div');
      cell.textContent = cat.label;
      header.appendChild(cell);
    });
    const infoHead = document.createElement('div');
    infoHead.textContent = '정보';
    header.appendChild(infoHead);
    table.appendChild(header);

    data.months.forEach((month) => {
      const row = document.createElement('article');
      row.className = 'future-main-table-row';
      const monthCell = document.createElement('h2');
      monthCell.className = 'future-main-month';
      monthCell.textContent = month.label;
      row.appendChild(monthCell);
      FUTURE_CATEGORIES.forEach((cat) => {
        const cell = document.createElement('section');
        cell.className = 'future-main-cell';
        const slot = document.createElement('div');
        slot.className = 'future-main-char-slot';
        slot.appendChild(
          renderFutureCategoryContent(month.categories[cat.id] || [], true, month.id, cat.id, futureMainOwnedIdSet)
        );
        cell.appendChild(slot);
        row.appendChild(cell);
      });
      const info = document.createElement('p');
      info.className = 'future-month-info';
      info.textContent = month.info || '';
      row.appendChild(info);
      table.appendChild(row);
    });
    futureMainSheet.appendChild(table);
  }

  function renderFutureAdmin() {
    if (!futureAdminSheet) return;
    futureSightState = ensureFutureState(futureSightState);
    futureAdminSheet.innerHTML = '';

    const table = document.createElement('div');
    table.className = 'future-admin-table';

    const header = document.createElement('div');
    header.className = 'future-admin-row future-admin-row--head';
    const monthHead = document.createElement('div');
    monthHead.textContent = '달';
    header.appendChild(monthHead);
    FUTURE_CATEGORIES.forEach((cat) => {
      const cell = document.createElement('div');
      cell.textContent = cat.label;
      header.appendChild(cell);
    });
    const infoHead = document.createElement('div');
    infoHead.textContent = '정보';
    header.appendChild(infoHead);
    table.appendChild(header);

    futureSightState.months.forEach((month, index) => {
      const row = document.createElement('div');
      row.className = 'future-admin-row';

      const monthCell = document.createElement('div');
      monthCell.className = 'future-admin-month-head';
      const input = document.createElement('input');
      input.className = 'future-month-label-input';
      input.value = month.label;
      input.ariaLabel = '월 이름';
      input.addEventListener('input', () => {
        const nextLabel = input.value.trim() || `${month.monthNumber || addMonthsNumber(currentMonthNumber(), index)}월`;
        month.label = nextLabel;
        month.monthNumber = parseMonthNumber(nextLabel) || month.monthNumber;
      });
      monthCell.appendChild(input);
      row.appendChild(monthCell);

      FUTURE_CATEGORIES.forEach((cat) => {
        const cell = document.createElement('div');
        cell.className = 'future-admin-cell';
        const slot = document.createElement('div');
        slot.className = 'future-admin-char-slot';
        slot.appendChild(renderFutureCategoryContent(month.categories[cat.id] || [], false, month.id, cat.id));
        cell.appendChild(slot);
        const actions = document.createElement('div');
        actions.className = 'future-cell-actions';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'future-mini-btn future-mini-btn--add';
        addBtn.textContent = '추가';
        addBtn.dataset.futureAction = 'add-character';
        addBtn.dataset.monthId = month.id;
        addBtn.dataset.categoryId = cat.id;
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'future-mini-btn future-mini-btn--delete';
        delBtn.textContent = '삭제';
        delBtn.dataset.futureAction = 'delete-character';
        delBtn.dataset.monthId = month.id;
        delBtn.dataset.categoryId = cat.id;
        actions.append(addBtn, delBtn);
        cell.appendChild(actions);
        row.appendChild(cell);
      });

      const infoCell = document.createElement('button');
      infoCell.type = 'button';
      infoCell.className = 'future-info-cell';
      infoCell.dataset.futureAction = 'info';
      infoCell.dataset.monthId = month.id;
      infoCell.textContent = month.info || '클릭하여 정보 입력';
      row.appendChild(infoCell);
      table.appendChild(row);
    });

    const addRow = document.createElement('div');
    addRow.className = 'future-admin-row future-admin-row--add';
    const addCell = document.createElement('div');
    addCell.className = 'future-admin-add-month';
    addCell.textContent = '월 추가';
    const addAction = document.createElement('div');
    addAction.className = 'future-admin-add-action';
    const addMonthBtn = document.createElement('button');
    addMonthBtn.type = 'button';
    addMonthBtn.className = 'btn btn-outline btn-sm';
    addMonthBtn.textContent = '달 추가';
    addMonthBtn.addEventListener('click', () => {
      const lastMonth = futureSightState.months[futureSightState.months.length - 1];
      const baseMonth = normalizeMonthNumber(lastMonth?.monthNumber) || parseMonthNumber(lastMonth?.label) || currentMonthNumber();
      futureSightState.months.push(makeFutureMonth(1, baseMonth));
      renderFutureAdmin();
    });
    addAction.appendChild(addMonthBtn);
    addRow.append(addCell, addAction);
    table.appendChild(addRow);
    futureAdminSheet.appendChild(table);
  }

  async function syncFutureMainOwnedHighlights() {
    if (sessionUserRole === 'guest') {
      futureMainOwnedIdSet = null;
    } else {
      try {
        const ocRes = await fetch('/api/me/owned-characters', {
          credentials: 'include',
          cache: 'no-store',
        });
        const ocData = await ocRes.json().catch(() => ({}));
        if (!ocRes.ok || !Array.isArray(ocData.characters)) {
          futureMainOwnedIdSet = new Set();
        } else {
          futureMainOwnedIdSet = new Set(ocData.characters.map((c) => String(c.id)));
        }
      } catch {
        futureMainOwnedIdSet = new Set();
      }
    }
    if (futureSightState) renderFutureMain(futureSightState);
    if (sessionUserRole === 'admin') renderFutureAdmin();
  }

  async function loadFutureSight() {
    try {
      const data = await apiJson('/api/future-sight', { credentials: 'include', cache: 'no-store' });
      futureSightState = ensureFutureState(data.data);
    } catch {
      futureSightState = ensureFutureState(null);
    }
    await syncFutureMainOwnedHighlights();
  }

  async function loadFutureSightForAdmin() {
    if (sessionUserRole !== 'admin') return;
    if (!futureSightState) await loadFutureSight();
    renderFutureAdmin();
  }

  function getFutureTypeModalCharacter(ctx) {
    if (!ctx) return null;
    if (ctx.kind === 'pick') return ctx.character;
    if (ctx.kind === 'pick-batch-queue') return ctx.characters[ctx.index];
    if (ctx.kind === 'edit') {
      const month = findFutureMonth(ctx.monthId);
      const entry = month?.categories?.[ctx.categoryId]?.[ctx.index];
      if (!entry) return null;
      return {
        id: entry.characterId ?? entry.id,
        name: entry.name,
        imageUrl: entry.imageUrl,
      };
    }
    return null;
  }

  function clearFutureTypeRadios() {
    futureTypeModal?.querySelectorAll('input[name="future-type-choice"]').forEach((r) => {
      r.checked = false;
    });
  }

  function setFutureTypeRadios(value) {
    clearFutureTypeRadios();
    if (value === 'limited' || value === 'permanent' || value === 'pass') {
      const el = futureTypeModal?.querySelector(`input[name="future-type-choice"][value="${value}"]`);
      if (el) el.checked = true;
    }
  }

  function syncFutureTypeNextEnabled() {
    const next = document.getElementById('future-type-next');
    if (!next) return;
    const picked = futureTypeModal?.querySelector('input[name="future-type-choice"]:checked');
    next.disabled = !picked;
  }

  function fitFutureTypeNameToOneLine(el, rawName) {
    if (!el) return;
    el.textContent = String(rawName || '캐릭터');
    el.style.removeProperty('font-size');
    const maxPx = 15;
    const minPx = 9;
    let px = maxPx;
    el.style.fontSize = `${px}px`;
    void el.offsetWidth;
    while (px > minPx && el.scrollWidth > el.clientWidth) {
      px -= 0.5;
      el.style.fontSize = `${px}px`;
    }
  }

  function bindFutureTypeImgAndName(img, nameEl, ch) {
    if (!img || !nameEl || !ch) return;
    const charId = String(ch.id);
    const label = String(ch.name || '캐릭터');
    img.alt = label;
    const url = ch.imageUrl || `/api/characters/${encodeURIComponent(charId)}/image`;
    img.dataset.futureTypeBindId = charId;
    const runFit = () => {
      if (String(img.dataset.futureTypeBindId) !== charId) return;
      const cur = getFutureTypeModalCharacter(futureTypeContext);
      if (!cur || String(cur.id) !== charId) return;
      fitFutureTypeNameToOneLine(nameEl, String(cur.name || '캐릭터'));
    };
    img.addEventListener('load', runFit, { once: true });
    img.src = url;
    if (img.complete) requestAnimationFrame(() => requestAnimationFrame(runFit));
    else requestAnimationFrame(() => requestAnimationFrame(runFit));
  }

  /** @param {{ restoreType?: 'limited'|'permanent'|'pass' }} [opts] */
  function syncFutureTypeModalUI(opts) {
    const restoreType = opts?.restoreType;
    const ctx = futureTypeContext;
    const sub = document.getElementById('future-type-sub');
    const img = document.getElementById('future-type-img');
    const nameEl = document.getElementById('future-type-name');
    if (!ctx) {
      if (sub) sub.hidden = true;
      return;
    }
    const ch = getFutureTypeModalCharacter(ctx);
    if (!ch) {
      if (sub) sub.hidden = true;
      return;
    }
    fitFutureTypeNameToOneLine(nameEl, String(ch.name || '캐릭터'));
    bindFutureTypeImgAndName(img, nameEl, ch);

    if (sub) {
      if (ctx.kind === 'pick-batch-queue' && ctx.characters.length > 1) {
        sub.hidden = false;
        sub.textContent = `${ctx.index + 1} / ${ctx.characters.length}`;
      } else {
        sub.hidden = true;
      }
    }

    if (restoreType === 'limited' || restoreType === 'permanent' || restoreType === 'pass') {
      setFutureTypeRadios(restoreType);
    } else if (ctx.kind === 'edit') {
      const month = findFutureMonth(ctx.monthId);
      const entry = month?.categories?.[ctx.categoryId]?.[ctx.index];
      const t =
        entry?.type === 'pass' ? 'pass' : entry?.type === 'limited' ? 'limited' : 'permanent';
      setFutureTypeRadios(t);
    } else {
      setFutureTypeRadios('limited');
    }
    syncFutureTypeNextEnabled();
  }

  function syncFutureTypeNavLabels() {
    const back = document.getElementById('future-type-back');
    const next = document.getElementById('future-type-next');
    const ctx = futureTypeContext;
    if (!back || !next || !ctx) return;
    if (ctx.kind === 'pick-batch-queue') {
      back.textContent = ctx.index === 0 ? '취소' : '뒤로';
      next.textContent = ctx.index >= ctx.characters.length - 1 ? '완료' : '다음';
    } else {
      back.textContent = '취소';
      next.textContent = '완료';
    }
  }

  function flushPickBatchResolvedToMonth(ctx) {
    const month = findFutureMonth(ctx.monthId);
    if (!month) return;
    const list = month.categories[ctx.categoryId] || [];
    const isSimultaneous = ctx.specialSlot === 'simultaneous';
    const gid =
      typeof ctx.specialGroupId === 'string' && ctx.specialGroupId.trim().length > 0
        ? ctx.specialGroupId.trim().slice(0, 80)
        : '';
    for (const { character: ch, type: ty } of ctx.resolved) {
      list.push({
        characterId: ch.id,
        id: ch.id,
        name: ch.name,
        imageUrl: ch.imageUrl,
        type: ty,
        ...(isSimultaneous ? { simultaneousRerun: true } : { prizeGacha: true }),
        ...(gid ? { specialGroupId: gid } : {}),
      });
    }
    month.categories[ctx.categoryId] = list;
  }

  function applyFutureTypePickSingle(t) {
    const ctx = futureTypeContext;
    if (!ctx || ctx.kind !== 'pick' || !futureSightState) return;
    const c = ctx.character;
    const month = findFutureMonth(ctx.monthId);
    if (!month) return;
    const list = month.categories[ctx.categoryId] || [];
    const entry = {
      characterId: c.id,
      id: c.id,
      name: c.name,
      imageUrl: c.imageUrl,
      type: t,
    };
    if (typeof ctx.index === 'number') {
      const prev = list[ctx.index];
      if (prev?.prizeGacha === true) entry.prizeGacha = true;
      if (prev?.simultaneousRerun === true) entry.simultaneousRerun = true;
      if (typeof prev?.specialGroupId === 'string' && prev.specialGroupId.trim().length > 0) {
        entry.specialGroupId = prev.specialGroupId.trim().slice(0, 80);
      }
      list[ctx.index] = entry;
    } else {
      list.push(entry);
    }
    month.categories[ctx.categoryId] = list;
  }

  function applyFutureTypeEdit(t) {
    const ctx = futureTypeContext;
    if (!ctx || ctx.kind !== 'edit' || !futureSightState) return;
    const month = findFutureMonth(ctx.monthId);
    const entry = month?.categories?.[ctx.categoryId]?.[ctx.index];
    if (!entry) return;
    entry.type = t;
    delete entry.princessPass;
  }

  function futureTypeGoNext() {
    const ctx = futureTypeContext;
    if (!ctx || !futureSightState) return;
    const picked = futureTypeModal?.querySelector('input[name="future-type-choice"]:checked');
    if (!picked) return;
    const t =
      picked.value === 'pass' ? 'pass' : picked.value === 'limited' ? 'limited' : 'permanent';

    if (ctx.kind === 'edit') {
      applyFutureTypeEdit(t);
      closeFutureTypePicker();
      renderFutureAdmin();
      return;
    }
    if (ctx.kind === 'pick') {
      applyFutureTypePickSingle(t);
      closeFutureTypePicker();
      renderFutureAdmin();
      return;
    }
    if (ctx.kind === 'pick-batch-queue') {
      const cur = ctx.characters[ctx.index];
      if (!cur) {
        closeFutureTypePicker();
        return;
      }
      ctx.resolved.push({ character: cur, type: t });
      if (ctx.index >= ctx.characters.length - 1) {
        flushPickBatchResolvedToMonth(ctx);
        closeFutureTypePicker();
        renderFutureAdmin();
        return;
      }
      ctx.index += 1;
      syncFutureTypeModalUI();
      syncFutureTypeNavLabels();
    }
  }

  function futureTypeGoBack() {
    const ctx = futureTypeContext;
    if (!ctx) return;
    if (ctx.kind === 'pick-batch-queue') {
      if (ctx.index === 0) {
        closeFutureTypePicker();
        return;
      }
      ctx.index -= 1;
      const undone = ctx.resolved.pop();
      const prevType =
        undone && (undone.type === 'limited' || undone.type === 'permanent' || undone.type === 'pass')
          ? undone.type
          : 'limited';
      syncFutureTypeModalUI({ restoreType: prevType });
      syncFutureTypeNavLabels();
      return;
    }
    closeFutureTypePicker();
  }

  function syncFutureCharacterBulkModeFromCheckboxes() {
    const prizeCb = document.getElementById('future-character-prize-checkbox');
    const simCb = document.getElementById('future-character-simultaneous-checkbox');
    if (prizeCb?.checked) {
      futureCharacterBulkMode = 'prize';
    } else if (simCb?.checked) {
      futureCharacterBulkMode = 'simultaneous';
    } else {
      futureCharacterBulkMode = 'none';
    }
  }

  function isFuturePrizeGachaPickMode() {
    return futureCharacterBulkMode === 'prize';
  }

  function isFutureSimultaneousRerunPickMode() {
    return futureCharacterBulkMode === 'simultaneous';
  }

  function getActiveFutureCharacterBulkPickMap() {
    if (futureCharacterBulkMode === 'prize') return futureCharacterPickMap;
    if (futureCharacterBulkMode === 'simultaneous') return futureCharacterSimultaneousMap;
    return null;
  }

  function resetFutureCharacterBulkSelectionUi() {
    futureCharacterPickMap = new Map();
    futureCharacterSimultaneousMap = new Map();
    futureCharacterPickSelected = null;
    futureCharacterGrid?.querySelectorAll('.character-picker-btn').forEach((b) => b.classList.remove('is-selected'));
  }

  function syncFutureBulkCheckboxExclusivity(changedId) {
    const prizeCb = document.getElementById('future-character-prize-checkbox');
    const simCb = document.getElementById('future-character-simultaneous-checkbox');
    if (prizeCb && simCb) {
      if (changedId === 'future-character-prize-checkbox' && prizeCb.checked) {
        simCb.checked = false;
      } else if (changedId === 'future-character-simultaneous-checkbox' && simCb.checked) {
        prizeCb.checked = false;
      }
    }
    syncFutureCharacterBulkModeFromCheckboxes();
  }

  function applyFutureCharacterDirect(character) {
    if (!futureCharacterTarget || !futureSightState) return;
    const month = findFutureMonth(futureCharacterTarget.monthId);
    if (!month) return;
    const list = month.categories[futureCharacterTarget.categoryId] || [];
    const entry = {
      characterId: character.id,
      id: character.id,
      name: character.name,
      imageUrl: character.imageUrl,
      type: 'permanent',
    };
    if (typeof futureCharacterTarget.index === 'number') {
      const prev = list[futureCharacterTarget.index];
      if (prev?.prizeGacha === true) entry.prizeGacha = true;
      if (prev?.simultaneousRerun === true) entry.simultaneousRerun = true;
      if (typeof prev?.specialGroupId === 'string' && prev.specialGroupId.trim().length > 0) {
        entry.specialGroupId = prev.specialGroupId.trim().slice(0, 80);
      }
      list[futureCharacterTarget.index] = entry;
    } else {
      list.push(entry);
    }
    month.categories[futureCharacterTarget.categoryId] = list;
    renderFutureAdmin();
  }

  function confirmFutureCharacterAdd() {
    if (!futureCharacterTarget || !futureSightState) return;
    syncFutureCharacterBulkModeFromCheckboxes();
    const prizeMode = isFuturePrizeGachaPickMode();
    const simultaneousMode = isFutureSimultaneousRerunPickMode();
    if (prizeMode || simultaneousMode) {
      const bulkMap = prizeMode ? futureCharacterPickMap : futureCharacterSimultaneousMap;
      const chars = [...bulkMap.values()];
      const specialSlot = prizeMode ? 'prize' : 'simultaneous';
      if (chars.length === 0) {
        window.alert('추가할 캐릭터를 한 명 이상 선택해 주세요.');
        return;
      }
      const specialGroupId = makeFutureSpecialGroupId();
      const cat = futureCharacterTarget.categoryId;
      const needType = cat === 'new' || cat === 'rerun';
      if (needType) {
        futureTypeContext = {
          kind: 'pick-batch-queue',
          characters: chars.map((c) => ({
            id: c.id,
            name: c.name,
            imageUrl: c.imageUrl,
          })),
          index: 0,
          resolved: [],
          monthId: futureCharacterTarget.monthId,
          categoryId: cat,
          specialSlot,
          specialGroupId,
        };
        closeFutureCharacterPicker();
        if (!futureTypeModal) return;
        syncFutureTypeModalUI();
        syncFutureTypeNavLabels();
        futureTypeModal.hidden = false;
        refreshBodyScrollLock();
      } else {
        const month = findFutureMonth(futureCharacterTarget.monthId);
        if (!month) return;
        const list = month.categories[cat] || [];
        for (const c of chars) {
          list.push({
            characterId: c.id,
            id: c.id,
            name: c.name,
            imageUrl: c.imageUrl,
            type: 'permanent',
            ...(specialSlot === 'simultaneous' ? { simultaneousRerun: true } : { prizeGacha: true }),
            specialGroupId,
          });
        }
        month.categories[cat] = list;
        closeFutureCharacterPicker();
        renderFutureAdmin();
      }
      return;
    }
    const c = futureCharacterPickSelected;
    if (!c) {
      window.alert('캐릭터를 선택해 주세요.');
      return;
    }
    const cat = futureCharacterTarget.categoryId;
    const needType = cat === 'new' || cat === 'rerun';
    if (needType) {
      futureTypeContext = {
        kind: 'pick',
        character: c,
        monthId: futureCharacterTarget.monthId,
        categoryId: cat,
        index: futureCharacterTarget.index,
      };
      closeFutureCharacterPicker();
      if (!futureTypeModal) return;
      syncFutureTypeModalUI();
      syncFutureTypeNavLabels();
      futureTypeModal.hidden = false;
      refreshBodyScrollLock();
    } else {
      applyFutureCharacterDirect(c);
      closeFutureCharacterPicker();
    }
  }

  let futureCharacterSearchListenersBound = false;

  function normalizeCharacterSearchText(s) {
    try {
      return String(s || '')
        .normalize('NFC')
        .toLowerCase();
    } catch {
      return String(s || '').toLowerCase();
    }
  }

  function getFutureCharacterSearchInput() {
    return document.getElementById('future-character-search');
  }

  function bindFutureCharacterSearchListeners() {
    if (futureCharacterSearchListenersBound || !futureCharacterModal) return;
    futureCharacterSearchListenersBound = true;
    const onFilter = () => applyFutureCharacterSearchFilter();
    futureCharacterModal.addEventListener('input', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.id === 'future-character-search') onFilter();
    });
    futureCharacterModal.addEventListener('search', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.id === 'future-character-search') onFilter();
    });
    futureCharacterModal.addEventListener('compositionend', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.id === 'future-character-search') onFilter();
    });
    futureCharacterModal.addEventListener('change', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.id === 'future-character-prize-checkbox' || t?.id === 'future-character-simultaneous-checkbox') {
        syncFutureBulkCheckboxExclusivity(t.id);
        resetFutureCharacterBulkSelectionUi();
      }
    });
    document.getElementById('future-character-search-submit')?.addEventListener('click', () => applyFutureCharacterSearchFilter());
  }

  function applyFutureCharacterSearchFilter() {
    if (!futureCharacterGrid) return;
    syncFutureCharacterBulkModeFromCheckboxes();
    const inputEl = getFutureCharacterSearchInput();
    const raw = inputEl?.value ?? '';
    const q = normalizeCharacterSearchText(raw.trim());
    let visible = 0;
    futureCharacterGrid.querySelectorAll('.character-picker-btn').forEach((btn) => {
      const hay = btn.dataset.characterSearchName || '';
      const match = q.length === 0 || hay.includes(q);
      btn.classList.toggle('character-picker-btn--filtered-out', !match);
      if (match) visible += 1;
    });
    const bulkMap = getActiveFutureCharacterBulkPickMap();
    // 프라이즈 뽑기·동시픽업 등 다중 선택 모드에서는 검색으로 목록에서 숨겨져도 선택과 맵을 유지한다.
    // 그렇지 않으면 새 검색으로 캐릭터를 고를 때 필터에 안 걸린 기존 선택이 전부 해제되는 문제가 난다.
    if (!bulkMap) {
      const selected = futureCharacterGrid.querySelector('.character-picker-btn.is-selected');
      if (selected && selected.classList.contains('character-picker-btn--filtered-out')) {
        selected.classList.remove('is-selected');
        futureCharacterPickSelected = null;
      }
    }
    const emptyEl = document.getElementById('future-character-search-empty');
    if (emptyEl) {
      emptyEl.hidden = !(q.length > 0 && visible === 0);
    }
  }

  async function openFutureCharacterPicker(target) {
    if (!futureCharacterModal || !futureCharacterGrid) return;
    bindFutureCharacterSearchListeners();
    futureCharacterTarget = target;
    futureCharacterPickSelected = null;
    futureCharacterPickMap = new Map();
    futureCharacterSimultaneousMap = new Map();
    const prizeCb = document.getElementById('future-character-prize-checkbox');
    if (prizeCb) prizeCb.checked = false;
    const simCb = document.getElementById('future-character-simultaneous-checkbox');
    if (simCb) simCb.checked = false;
    syncFutureCharacterBulkModeFromCheckboxes();
    const searchInput = getFutureCharacterSearchInput();
    if (searchInput) searchInput.value = '';
    const emptyEl = document.getElementById('future-character-search-empty');
    if (emptyEl) emptyEl.hidden = true;
    const list = await ensureCharactersLoaded();
    futureCharacterGrid.innerHTML = '';
    list.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-picker-btn';
      btn.dataset.characterId = c.id;
      const rawName = String(c.name || '');
      btn.dataset.characterSearchName = normalizeCharacterSearchText(rawName);
      const thumb = document.createElement('div');
      thumb.className = 'character-thumb';
      const img = document.createElement('img');
      img.alt = rawName || '캐릭터';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = c.imageUrl || `/api/characters/${encodeURIComponent(c.id)}/image`;
      const name = document.createElement('div');
      name.className = 'character-name';
      name.textContent = rawName;
      thumb.appendChild(img);
      btn.append(thumb, name);
      btn.addEventListener('click', () => {
        syncFutureCharacterBulkModeFromCheckboxes();
        if (isFuturePrizeGachaPickMode()) {
          const id = String(c.id);
          if (futureCharacterPickMap.has(id)) {
            futureCharacterPickMap.delete(id);
            btn.classList.remove('is-selected');
          } else {
            futureCharacterPickMap.set(id, c);
            btn.classList.add('is-selected');
          }
        } else if (isFutureSimultaneousRerunPickMode()) {
          const id = String(c.id);
          if (futureCharacterSimultaneousMap.has(id)) {
            futureCharacterSimultaneousMap.delete(id);
            btn.classList.remove('is-selected');
          } else {
            futureCharacterSimultaneousMap.set(id, c);
            btn.classList.add('is-selected');
          }
        } else {
          futureCharacterPickSelected = c;
          futureCharacterPickMap.clear();
          futureCharacterSimultaneousMap.clear();
          futureCharacterGrid.querySelectorAll('.character-picker-btn').forEach((b) => {
            b.classList.toggle('is-selected', b === btn);
          });
        }
      });
      futureCharacterGrid.appendChild(btn);
    });
    applyFutureCharacterSearchFilter();
    futureCharacterModal.hidden = false;
    refreshBodyScrollLock();
    getFutureCharacterSearchInput()?.focus();
  }

  function closeFutureCharacterPicker() {
    if (!futureCharacterModal) return;
    futureCharacterModal.hidden = true;
    futureCharacterTarget = null;
    futureCharacterPickSelected = null;
    futureCharacterPickMap = new Map();
    futureCharacterSimultaneousMap = new Map();
    const prizeCb = document.getElementById('future-character-prize-checkbox');
    if (prizeCb) prizeCb.checked = false;
    const simCb = document.getElementById('future-character-simultaneous-checkbox');
    if (simCb) simCb.checked = false;
    syncFutureCharacterBulkModeFromCheckboxes();
    refreshBodyScrollLock();
  }

  function openFutureTypePickerForEdit(target) {
    futureTypeContext = {
      kind: 'edit',
      monthId: target.monthId,
      categoryId: target.categoryId,
      index: target.index,
    };
    if (!futureTypeModal) return;
    syncFutureTypeModalUI();
    syncFutureTypeNavLabels();
    futureTypeModal.hidden = false;
    refreshBodyScrollLock();
  }

  function closeFutureTypePicker() {
    if (!futureTypeModal) return;
    futureTypeModal.hidden = true;
    futureTypeContext = null;
    clearFutureTypeRadios();
    const next = document.getElementById('future-type-next');
    if (next) next.disabled = true;
    const sub = document.getElementById('future-type-sub');
    if (sub) sub.hidden = true;
    refreshBodyScrollLock();
  }

  function openFutureInfoEditor(monthId) {
    const month = findFutureMonth(monthId);
    if (!futureInfoModal || !futureInfoInput || !month) return;
    futureInfoMonthId = monthId;
    futureInfoInput.value = month.info || '';
    futureInfoModal.hidden = false;
    refreshBodyScrollLock();
    futureInfoInput.focus();
  }

  function closeFutureInfoEditor() {
    if (!futureInfoModal) return;
    futureInfoModal.hidden = true;
    futureInfoMonthId = null;
    refreshBodyScrollLock();
  }

  function saveFutureInfoEditor() {
    const month = futureInfoMonthId ? findFutureMonth(futureInfoMonthId) : null;
    if (month && futureInfoInput) {
      month.info = futureInfoInput.value.trim();
      renderFutureAdmin();
    }
    closeFutureInfoEditor();
  }

  document.querySelectorAll('.mypage-nav-btn[data-mypage-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setMypageTab(btn.dataset.mypageTab || 'profile'));
  });

  adminToggle?.addEventListener('click', () => {
    const willOpen = Boolean(adminSubnav?.hidden);
    if (adminSubnav) adminSubnav.hidden = !willOpen;
    adminToggle.classList.toggle('is-active', willOpen);
    if (willOpen) setMypageTab('admin-future');
  });

  futureAdminSheet?.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-future-action]') : null;
    if (!target) return;
    const action = target.dataset.futureAction;
    const monthId = target.dataset.monthId || '';
    const categoryId = target.dataset.categoryId || '';
    const indexRaw = target.dataset.index;
    const index = typeof indexRaw === 'string' ? Number(indexRaw) : NaN;
    if (action === 'add-character') {
      void openFutureCharacterPicker({ monthId, categoryId });
    } else if (action === 'replace-character' && Number.isInteger(index)) {
      void openFutureCharacterPicker({ monthId, categoryId, index });
    } else if (action === 'delete-character') {
      const month = findFutureMonth(monthId);
      const list = month?.categories?.[categoryId];
      if (Array.isArray(list)) {
        list.pop();
        renderFutureAdmin();
      }
    } else if (action === 'type' && Number.isInteger(index)) {
      openFutureTypePickerForEdit({ monthId, categoryId, index });
    } else if (action === 'info') {
      openFutureInfoEditor(monthId);
    }
  });

  futureAdminSave?.addEventListener('click', async () => {
    if (sessionUserRole !== 'admin') return;
    futureAdminSave.disabled = true;
    if (futureAdminStatus) {
      futureAdminStatus.textContent = '저장 중입니다...';
      futureAdminStatus.classList.remove('is-ok', 'is-warn');
    }
    try {
      const data = await apiJson('/api/admin/future-sight', {
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ data: futurePayloadForSave() }),
      });
      futureSightState = ensureFutureState(data.data);
      renderFutureAdmin();
      renderFutureMain(futureSightState);
      if (futureAdminStatus) {
        futureAdminStatus.textContent = '변경 사항이 저장되었습니다.';
        futureAdminStatus.classList.add('is-ok');
      }
    } catch (err) {
      if (futureAdminStatus) {
        futureAdminStatus.textContent = err instanceof Error ? err.message : String(err);
        futureAdminStatus.classList.add('is-warn');
      }
    } finally {
      futureAdminSave.disabled = false;
    }
  });

  document.getElementById('future-character-add')?.addEventListener('click', () => confirmFutureCharacterAdd());
  document.getElementById('future-character-modal-close')?.addEventListener('click', closeFutureCharacterPicker);
  bindFutureCharacterSearchListeners();
  futureCharacterModal?.querySelectorAll('[data-close-future-character]').forEach((el) => {
    el.addEventListener('click', closeFutureCharacterPicker);
  });
  futureCharacterModal?.addEventListener('click', (e) => {
    if (e.target === futureCharacterModal) closeFutureCharacterPicker();
  });
  futureTypeModal?.querySelectorAll('[data-close-future-type]').forEach((el) => {
    el.addEventListener('click', closeFutureTypePicker);
  });
  futureTypeModal?.addEventListener('click', (e) => {
    if (e.target === futureTypeModal) closeFutureTypePicker();
  });
  futureTypeModal?.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.name === 'future-type-choice') syncFutureTypeNextEnabled();
  });
  document.getElementById('future-type-back')?.addEventListener('click', () => futureTypeGoBack());
  document.getElementById('future-type-next')?.addEventListener('click', () => futureTypeGoNext());
  futureInfoCancel?.addEventListener('click', closeFutureInfoEditor);
  futureInfoSave?.addEventListener('click', saveFutureInfoEditor);
  futureInfoModal?.querySelectorAll('[data-close-future-info]').forEach((el) => {
    el.addEventListener('click', closeFutureInfoEditor);
  });
  futureInfoModal?.addEventListener('click', (e) => {
    if (e.target === futureInfoModal) closeFutureInfoEditor();
  });

  headerOpenMypage?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveBoard('mypage');
    setMypageTab('profile');
    window.scrollTo(0, 0);
  });

  brandLink?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveBoard('main');
    window.scrollTo(0, 0);
  });

  mypageToMain?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveBoard('main');
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
    if (!NICKNAME_CHARS_RE.test(nickname)) {
      mypageNicknameApprovedFor = null;
      setCheckFeedback(
        mypageNicknameFeedbackEl,
        '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.',
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
    sessionUserRole = 'guest';
    setAdminNavigationVisible(false);
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
    sessionUserRole = user.role === 'admin' ? 'admin' : 'user';
    setAdminNavigationVisible(sessionUserRole === 'admin');

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
    if (modal && !modal.hidden) return;
    openLoginBtn?.focus();
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
      await syncFutureMainOwnedHighlights();
      loginForm.reset();
      closeLoginModal();
    } finally {
      loginSubmitBtn.disabled = false;
    }
  });

  headerLogoutBtn?.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* 네트워크 오류: 세션 쿠키 제거 응답을 못 받았을 수 있음. 이동 후 /api/me 기준으로 다시 판별 */
    }
    /* 서버가 Set-Cookie로 세션을 지운 뒤, 메인 게시판 기준으로 문서 전체를 다시 로드해 로그아웃 UI를 확실히 반영 */
    window.location.assign('/');
  });

  window.addEventListener('load', () => {
    void (async () => {
      await refreshSessionHeader();
      refreshPublicRuntimeConfig();
      await loadFutureSight();
      window.setInterval(() => {
        void loadFutureSight();
      }, 24 * 60 * 60 * 1000);
    })();
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
    if (futureCharacterModal && !futureCharacterModal.hidden) {
      closeFutureCharacterPicker();
      e.preventDefault();
      return;
    }
    if (futureTypeModal && !futureTypeModal.hidden) {
      closeFutureTypePicker();
      e.preventDefault();
      return;
    }
    if (futureInfoModal && !futureInfoModal.hidden) {
      closeFutureInfoEditor();
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
    if (!NICKNAME_CHARS_RE.test(nickname)) {
      nicknameApprovedFor = null;
      setCheckFeedback(
        nicknameFeedbackEl,
        '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.',
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
        '아이디는 영문만 사용하고 8~20자로 입력해 주세요.',
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

  function getCharacterImageApiUrl(characterId) {
    return `/api/characters/${encodeURIComponent(String(characterId))}/image`;
  }

  function bindCharacterImage(img, character, { eager = false } = {}) {
    const apiUrl = getCharacterImageApiUrl(character?.id || '');
    const staticUrl = typeof character?.imageUrl === 'string' && character.imageUrl.length > 0
      ? character.imageUrl
      : '';

    img.alt = character?.name || '캐릭터';
    img.loading = eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.classList.remove('character-thumb__img--missing');

    img.addEventListener('error', () => {
      if (img.dataset.fallback !== 'static' && staticUrl) {
        img.dataset.fallback = 'static';
        img.src = staticUrl;
        return;
      }
      img.classList.add('character-thumb__img--missing');
      img.removeAttribute('src');
    });

    img.dataset.fallback = 'api';
    img.src = apiUrl;
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
      bindCharacterImage(img, c);

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
      bindCharacterImage(img, c);

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
      const res = await fetch('/api/me/owned-characters', {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText =
          data && typeof data.error === 'string' && data.error.trim()
            ? data.error
            : `보유 목록을 불러오지 못했습니다. (${res.status})`;
        mypageOwnedEmpty.textContent = errText;
        mypageOwnedEmpty.hidden = false;
        mypageOwnedGridWrap.hidden = true;
        mypageOwnedGrid.innerHTML = '';
        return;
      }
      mypageOwnedEmpty.textContent = MYPAGE_OWNED_EMPTY_DEFAULT;
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
      mypageOwnedEmpty.textContent = '보유 목록을 불러오는 중 네트워크 오류가 발생했습니다.';
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
      const ownedRes = await fetch('/api/me/owned-characters', {
        credentials: 'include',
        cache: 'no-store',
      });
      const ownedData = await ownedRes.json().catch(() => ({}));
      if (!ownedRes.ok) {
        throw new Error(ownedData.error || '보유 목록을 불러올 수 없습니다.');
      }
      ownedUpdateSelection = new Set(
        (Array.isArray(ownedData.characters) ? ownedData.characters : []).map((c) => String(c.id))
      );
      if (ownedUpdateSearchInput) ownedUpdateSearchInput.value = '';
      renderCharacterPickerInto(ownedUpdateGrid, list, () => ownedUpdateSelection);
      applyOwnedUpdateCharacterSearchFilter();
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

  ownedUpdateSearchSubmit?.addEventListener('click', () => applyOwnedUpdateCharacterSearchFilter());
  ownedUpdateSearchInput?.addEventListener('input', () => applyOwnedUpdateCharacterSearchFilter());
  ownedUpdateSearchInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    applyOwnedUpdateCharacterSearchFilter();
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

  async function handleOwnedUpdateSave() {
    /* 클릭 시점에 DOM을 재조회해 stale reference 문제를 원천 차단 */
    const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('owned-update-save'));
    const errEl   = /** @type {HTMLElement|null}       */ (document.getElementById('owned-update-error'));

    if (!saveBtn || saveBtn.disabled) return;

    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

    const characterIds = ownedUpdateSelectedIdsFromDom();
    ownedUpdateSelection = new Set(characterIds);
    const originalLabel = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';

    try {
      const res = await fetch('/api/me/owned-characters', {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `저장 실패 (${res.status})`);
      }
      /* 성공 */
      closeOwnedCharactersModal();
      await refreshMypageOwnedList();
      await syncFutureMainOwnedHighlights();
    } catch (e) {
      const errElCatch = document.getElementById('owned-update-error');
      if (errElCatch) {
        errElCatch.textContent = e instanceof Error ? e.message : String(e);
        errElCatch.hidden = false;
      }
    } finally {
      const saveBtnFinal = document.getElementById('owned-update-save');
      if (saveBtnFinal) {
        saveBtnFinal.disabled = false;
        saveBtnFinal.textContent = originalLabel;
      }
    }
  }

  /* 저장은 폼 submit 한 경로로만 처리(Enter·접근성·버튼 타입 실수에 대비) */
  ownedUpdateForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleOwnedUpdateSave();
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
      renderCharacterPickerInto(characterGrid, list, () => selectedCharacterIds);
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

  /* ========== 클랜전 게시판 ========== */

  const clanCatBtns = Array.from(document.querySelectorAll('.clan-cat-btn'));
  const clanPostList = document.getElementById('clan-post-list');
  const clanBoardEmpty = document.getElementById('clan-board-empty');
  const clanPagination = document.getElementById('clan-pagination');
  const clanPostDetail = document.getElementById('clan-post-detail');
  const clanDetailContent = document.getElementById('clan-detail-content');
  const clanDetailBoardTitle = document.getElementById('clan-detail-board-title');
  const clanDetailEditBtn = document.getElementById('clan-detail-edit-btn');
  const clanDetailDeleteBtn = document.getElementById('clan-detail-delete-btn');
  const clanDetailWriteBtn = document.getElementById('clan-detail-write-btn');
  const clanDetailActions = document.getElementById('clan-detail-actions');
  const clanLikeBtn = document.getElementById('clan-like-btn');
  const clanLikeText = document.getElementById('clan-like-text');
  const clanLikeCount = document.getElementById('clan-like-count');
  const clanCommentsSection = document.getElementById('clan-comments-section');
  const clanCommentCount = document.getElementById('clan-comment-count');
  const clanCommentsList = document.getElementById('clan-comments-list');
  const clanCommentPagination = document.getElementById('clan-comment-pagination');
  const clanWriteOpenBtn = document.getElementById('clan-write-open');
  const clanPostWrite = document.getElementById('clan-post-write');
  const clanWriteForm = document.getElementById('clan-write-form');
  const clanWriteBoardName = document.getElementById('clan-write-board-name');
  const clanWriteCategorySelect = document.getElementById('clan-write-category');
  const clanWriteTitle = document.getElementById('clan-write-title');
  const clanWriteTitleWarning = document.getElementById('clan-write-title-warning');
  const clanWriteContent = document.getElementById('clan-write-content');
  const clanWriteSubmit = document.getElementById('clan-write-submit');
  const clanWriteCancel = document.getElementById('clan-write-cancel');
  const clanWriteBack = document.getElementById('clan-write-back');
  const clanWriteError = document.getElementById('clan-write-error');
  const clanWriteToolbar = document.getElementById('clan-write-toolbar');
  const clanWriteBtnImage = document.getElementById('clan-write-btn-image');
  const clanWriteBtnVideo = document.getElementById('clan-write-btn-video');
  const clanWriteBtnLink = document.getElementById('clan-write-btn-link');
  const clanWriteBtnTactic = document.getElementById('clan-write-btn-tactic');
  const clanWriteFontsize = document.getElementById('clan-write-fontsize');
  const clanWriteBtnBold = document.getElementById('clan-write-btn-bold');
  const clanWriteBtnItalic = document.getElementById('clan-write-btn-italic');
  const clanWriteBtnUnderline = document.getElementById('clan-write-btn-underline');
  const clanWriteBtnStrike = document.getElementById('clan-write-btn-strike');
  const clanWriteImageInput = document.getElementById('clan-write-image-input');
  const clanWriteVideoInput = document.getElementById('clan-write-video-input');
  const clanWriteLinkPopup = document.getElementById('clan-write-link-popup');
  const clanWriteLinkInput = document.getElementById('clan-write-link-input');
  const clanWriteLinkInsert = document.getElementById('clan-write-link-insert');
  const clanWriteLinkCancel = document.getElementById('clan-write-link-cancel');
  const clanWriteBossImageInput = document.getElementById('clan-write-boss-image-input');
  const tacticCharPopup = document.getElementById('tactic-character-popup');
  const tacticCharPopupGrid = document.getElementById('tactic-character-popup-grid');
  const tacticCharPopupSearch = document.getElementById('tactic-character-popup-search');
  const tacticCharPopupCancel = document.getElementById('tactic-character-popup-cancel');
  const tacticCharPopupConfirm = document.getElementById('tactic-character-popup-confirm');
  const tacticCharPopupSearchBtn = document.getElementById('tactic-character-popup-search-btn');
  const tacticCharPopupEmpty = document.getElementById('tactic-character-popup-empty');
  let tacticCharTargetCell = null;
  let tacticCharSelectedId = null;
  const clanCommentWriteForm = document.getElementById('clan-comment-write-form');
  const clanCommentInput = document.getElementById('clan-comment-input');
  const clanCommentSubmit = document.getElementById('clan-comment-submit');
  const clanCommentError = document.getElementById('clan-comment-error');

  let clanBoardPage = 1;
  let clanBoardCategory = 'all';
  let clanBoardSearchText = '';
  let clanBoardCurrentPostId = null;
  let clanBoardCurrentPostLiked = false;
  let clanBoardCurrentPostData = null;
  let clanBoardEditingPostId = null;
  let clanWriteCategory = 'none';

  function setClanBoardListChromeVisible(visible) {
    const clanBoardHeader = document.querySelector('.clan-board-header');
    const bottomActions = document.getElementById('clan-board-bottom-actions');
    if (clanBoardHeader) clanBoardHeader.hidden = !visible;
    if (bottomActions && !visible) bottomActions.hidden = true;
  }

  function getClanRoute() {
    const m = window.location.pathname.match(/^\/clan-board\/post\/([a-zA-Z0-9_-]+)$/);
    return m ? { route: 'clan-post', postId: m[1] } : { route: 'clan-board' };
  }

  function navigateToClanPost(postId) {
    const url = `/clan-board/post/${encodeURIComponent(postId)}`;
    history.pushState({ route: 'clan-post', postId }, '', url);
    showClanPostDetailView(postId);
  }

  function navigateToClanBoard() {
    history.pushState({ route: 'clan-board' }, '', '/');
    const panel = document.querySelector('[data-board-panel="clan"]');
    if (panel && !panel.hidden) {
      loadClanBoardPosts();
    } else {
      queueMicrotask(() => setActiveBoard('clan'));
    }
  }

  function showClanPostDetailView(postId) {
    const panel = document.querySelector('[data-board-panel="clan"]');
    const writePanel = document.querySelector('[data-board-panel="clan-write"]');
    if (writePanel) writePanel.hidden = true;
    if (panel) panel.hidden = false;
    if (!clanPostDetail || !clanDetailContent) return;
    setClanBoardListChromeVisible(false);
    clanPostList.hidden = true;
    if (clanBoardEmpty) clanBoardEmpty.hidden = true;
    clanPagination.hidden = true;
    clanDetailActions.hidden = true;
    clanCommentsSection.hidden = true;
    if (clanCommentPagination) clanCommentPagination.hidden = true;
    clanPostDetail.hidden = false;
    clanDetailContent.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px 0;">불러오는 중...</p>';

    fetch(`/api/clan-board/posts/${encodeURIComponent(postId)}/view`, { method: 'PATCH' }).catch(() => {});

    fetch(`/api/clan-board/posts/${encodeURIComponent(postId)}`, { credentials: 'include' })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (!data.ok) {
          clanDetailContent.innerHTML = `<p style="text-align:center;color:var(--muted);padding:40px 0;">${data.error || '게시물을 불러올 수 없습니다.'}</p>`;
          return;
        }
        clanBoardCurrentPostId = postId;
        clanBoardCurrentPostLiked = data.post.liked || false;
        renderClanPostDetail(data.post);
      })
      .catch(() => {
        clanDetailContent.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px 0;">네트워크 오류가 발생했습니다.</p>';
      });
  }

  window.addEventListener('popstate', (e) => {
    const route = e.state ? e.state.route : getClanRoute().route;
    if (route === 'clan-board') {
      clanPostDetail.hidden = true;
      loadClanBoardPosts();
    } else if (route === 'clan-post' && e.state && e.state.postId) {
      showClanPostDetailView(e.state.postId);
    } else {
      const r = getClanRoute();
      if (r.route === 'clan-post') {
        showClanPostDetailView(r.postId);
      } else {
        clanPostDetail.hidden = true;
        loadClanBoardPosts();
      }
    }
  });

  // Initial load routing
  queueMicrotask(() => {
    const route = getClanRoute();
    if (route.route === 'clan-post') {
      history.replaceState({ route: 'clan-post', postId: route.postId }, '', window.location.pathname);
      const panel = document.querySelector('[data-board-panel="clan"]');
      const writePanel = document.querySelector('[data-board-panel="clan-write"]');
      panels.forEach((p) => {
        const match = p.dataset.boardPanel === 'clan';
        p.hidden = !match;
        p.classList.toggle('is-visible', match);
      });
      if (writePanel) writePanel.hidden = true;
      if (panel) panel.hidden = false;
      document.querySelectorAll('.clan-dropdown-item').forEach((item) => {
        item.classList.toggle('is-active', item.dataset.board === 'clan-fullauto');
      });
      const clanFullautoLink = links.find((b) => b.dataset.board === 'clan-fullauto');
      links.forEach((l) => {
        const on = l === clanFullautoLink;
        l.classList.toggle('is-active', on);
        if (on) l.setAttribute('aria-current', 'page');
        else l.removeAttribute('aria-current');
      });
      if (clanFullautoLink) requestAnimationFrame(() => moveUnderline(clanFullautoLink));
      const subTitleEl = document.getElementById('clan-board-subtitle');
      if (subTitleEl) subTitleEl.textContent = '- 플오토';
      showClanPostDetailView(route.postId);
    }
  });

  const CATEGORY_LABELS = {
    all: '전체',
    none: '없음',
    general: '자유',
    phase1: '1넴',
    phase2: '2넴',
    phase3: '3넴',
    phase4: '4넴',
    phase5: '5넴',
  };

  function updateClanCategoryActive() {
    clanCatBtns.forEach((btn) => {
      const on = btn.dataset.category === clanBoardCategory;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  async function loadClanBoardPosts() {
    if (!clanPostList || !clanBoardEmpty || !clanPagination) return;
    setClanBoardListChromeVisible(true);
    clanPostDetail.hidden = true;
    clanBoardCurrentPostData = null;
    clanPostList.hidden = false;
    if (clanBoardEmpty) clanBoardEmpty.hidden = true;

    const params = new URLSearchParams();
    params.set('page', String(clanBoardPage));
    params.set('limit', '40');
    if (clanBoardCategory !== 'all') params.set('category', clanBoardCategory);
    if (clanBoardSearchText) params.set('search', clanBoardSearchText);

    try {
      const res = await fetch(`/api/clan-board/posts?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || '게시물을 불러오지 못했습니다.');
        return;
      }
      renderClanPostList(data.posts);
      renderClanPagination(clanPagination, data.pagination, (page) => {
        clanBoardPage = page;
        loadClanBoardPosts();
      });
      if (clanBoardEmpty) {
        clanBoardEmpty.hidden = data.posts.length > 0;
      }
      if (clanPostList) {
        clanPostList.hidden = data.posts.length === 0;
      }
      const bottomActions = document.getElementById('clan-board-bottom-actions');
      if (bottomActions) {
        bottomActions.hidden = data.posts.length === 0;
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '네트워크 오류가 발생했습니다.');
    }
  }

  function renderClanPostList(posts) {
    if (!clanPostList) return;
    clanPostList.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'clan-post-header-row';
    const headers = [
      { cls: 'clan-post-header-num', text: '번호' },
      { cls: 'clan-post-header-cat', text: '카테고리' },
      { cls: 'clan-post-header-title', text: '제목' },
      { cls: 'clan-post-header-author', text: '작성자' },
      { cls: 'clan-post-header-date', text: '날짜' },
      { cls: 'clan-post-header-views', text: '조회' },
    ];
    headers.forEach((h) => {
      const cell = document.createElement('div');
      cell.className = h.cls;
      cell.textContent = h.text;
      headerRow.appendChild(cell);
    });
    clanPostList.appendChild(headerRow);

    const baseIndex = (clanBoardPage - 1) * 40;

    posts.forEach((post, idx) => {
      const row = document.createElement('div');
      row.className = 'clan-post-row';
      if (post.is_pinned) row.classList.add('clan-post-row--pinned');
      row.setAttribute('role', 'listitem');
      row.addEventListener('click', () => openClanPostDetail(post.id));

      const numCell = document.createElement('div');
      numCell.className = 'clan-post-num-cell';
      numCell.textContent = post.is_pinned ? '공지' : String(baseIndex + idx + 1);

      const catCell = document.createElement('div');
      catCell.className = 'clan-post-category-cell';
      if (post.is_pinned) {
        const noticeBadge = document.createElement('span');
        noticeBadge.className = 'clan-post-badge clan-post-badge--notice';
        noticeBadge.textContent = '공지';
        catCell.appendChild(noticeBadge);
      }
      const badge = document.createElement('span');
      badge.className = `clan-post-badge clan-post-badge--${post.category}`;
      badge.textContent = CATEGORY_LABELS[post.category] || post.category;
      catCell.appendChild(badge);

      const titleCell = document.createElement('div');
      titleCell.className = 'clan-post-title-cell';
      const title = document.createElement('p');
      title.className = 'clan-post-title';
      title.textContent = post.title;
      titleCell.appendChild(title);

      const authorCell = document.createElement('div');
      authorCell.className = 'clan-post-author-cell';
      authorCell.textContent = post.author.nickname;

      const dateCell = document.createElement('div');
      dateCell.className = 'clan-post-date-cell';
      dateCell.textContent = formatClanDate(post.created_at);

      const viewsCell = document.createElement('div');
      viewsCell.className = 'clan-post-views-cell';
      viewsCell.textContent = String(post.view_count);

      row.appendChild(numCell);
      row.appendChild(catCell);
      row.appendChild(titleCell);
      row.appendChild(authorCell);
      row.appendChild(dateCell);
      row.appendChild(viewsCell);
      clanPostList.appendChild(row);
    });
  }

  function renderClanPagination(container, pagination, onPage) {
    if (!container) return;
    container.innerHTML = '';
    if (!pagination || pagination.totalPages <= 1) {
      container.hidden = true;
      return;
    }
    container.hidden = false;

    const { page, totalPages } = pagination;

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'clan-pagination-btn';
    prev.textContent = '\u2039';
    prev.disabled = page <= 1;
    prev.setAttribute('aria-label', '이전 페이지');
    prev.addEventListener('click', () => { if (page > 1) onPage(page - 1); });
    container.appendChild(prev);

    const maxVisible = 7;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'clan-pagination-btn';
      if (i === page) btn.classList.add('is-active');
      btn.textContent = String(i);
      btn.setAttribute('aria-label', `${i}페이지`);
      btn.addEventListener('click', () => onPage(i));
      container.appendChild(btn);
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'clan-pagination-btn';
    next.textContent = '\u203a';
    next.disabled = page >= totalPages;
    next.setAttribute('aria-label', '다음 페이지');
    next.addEventListener('click', () => { if (page < totalPages) onPage(page + 1); });
    container.appendChild(next);
  }

  function formatClanDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatClanFullDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function isClanPostEdited(post) {
    if (!post?.updated_at) return false;
    const created = new Date(post.created_at).getTime();
    const updated = new Date(post.updated_at).getTime();
    if (Number.isNaN(created) || Number.isNaN(updated)) return false;
    return updated - created > 60_000;
  }

  async function openClanPostDetail(postId) {
    navigateToClanPost(postId);
  }

  function renderClanPostDetail(post) {
    if (!clanDetailContent) return;

    clanBoardCurrentPostData = post;

    if (clanDetailBoardTitle) {
      clanDetailBoardTitle.textContent = getClanBoardNameDisplay();
    }

    const title = document.createElement('h3');
    title.className = 'clan-detail-title';
    title.textContent = post.title;

    const meta = document.createElement('div');
    meta.className = 'clan-detail-meta-row';

    const metaLeft = document.createElement('div');
    metaLeft.className = 'clan-detail-meta-left';
    const author = document.createElement('span');
    author.className = 'clan-detail-author';
    author.textContent = post.author.nickname;
    const date = document.createElement('span');
    date.className = 'clan-detail-date';
    const edited = isClanPostEdited(post);
    date.textContent = formatClanFullDate(edited ? post.updated_at : post.created_at);
    metaLeft.appendChild(author);
    metaLeft.appendChild(date);
    if (edited) {
      const editedLabel = document.createElement('span');
      editedLabel.className = 'clan-detail-edited';
      editedLabel.textContent = '(수정됨)';
      metaLeft.appendChild(editedLabel);
    }

    const metaRight = document.createElement('div');
    metaRight.className = 'clan-detail-meta-right';
    const views = document.createElement('span');
    views.className = 'clan-detail-views';
    views.textContent = `조회 ${post.view_count}`;
    const commentBadge = document.createElement('span');
    commentBadge.className = 'clan-detail-comment-badge';
    commentBadge.textContent = `댓글 ${post.comment_count}`;
    metaRight.appendChild(views);
    metaRight.appendChild(commentBadge);
    meta.appendChild(metaLeft);
    meta.appendChild(metaRight);

    const divider = document.createElement('hr');
    divider.className = 'clan-detail-rule';
    divider.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'clan-detail-body';
    body.innerHTML = post.content;

    clanDetailContent.innerHTML = '';
    clanDetailContent.appendChild(title);
    clanDetailContent.appendChild(meta);
    clanDetailContent.appendChild(divider);
    clanDetailContent.appendChild(body);

    if (clanDetailEditBtn) clanDetailEditBtn.hidden = !post.can_edit;
    if (clanDetailDeleteBtn) clanDetailDeleteBtn.hidden = !post.can_delete;

    clanDetailActions.hidden = false;
    clanLikeBtn.classList.toggle('is-liked', !!clanBoardCurrentPostLiked);
    clanLikeCount.textContent = String(post.like_count);
    clanLikeText.textContent = clanBoardCurrentPostLiked ? '추천 취소' : '추천';
    clanLikeBtn.disabled = false;

    clanCommentsSection.hidden = false;
    clanCommentCount.textContent = String(post.comment_count);
    loadClanBoardComments(post.id, 1);
    showClanCommentForm();
    resetClanCommentForm();
  }

  async function loadClanBoardComments(postId, page) {
    if (!clanCommentsList || !clanCommentPagination) return;
    try {
      const res = await fetch(`/api/clan-board/posts/${encodeURIComponent(postId)}/comments?page=${page}&limit=20`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      clanCommentsList.innerHTML = '';
      if (data.comments.length === 0) {
        clanCommentsList.innerHTML = '<p style="text-align:center;color:var(--muted);padding:16px 0;">댓글이 없습니다.</p>';
        clanCommentPagination.hidden = true;
        return;
      }

      data.comments.forEach((comment) => {
        const item = document.createElement('div');
        item.className = 'clan-comment-item';
        item.setAttribute('role', 'listitem');

        const avatar = document.createElement('div');
        avatar.className = 'clan-comment-avatar';
        if (comment.author.profileImage) {
          const img = document.createElement('img');
          img.src = comment.author.profileImage;
          img.alt = '';
          img.loading = 'lazy';
          avatar.appendChild(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'clan-comment-avatar-placeholder';
          ph.textContent = 'P';
          avatar.appendChild(ph);
        }

        const body = document.createElement('div');
        body.className = 'clan-comment-body';

        const head = document.createElement('div');
        head.className = 'clan-comment-head';
        const nick = document.createElement('span');
        nick.className = 'clan-comment-nickname';
        nick.textContent = comment.author.nickname;
        const date = document.createElement('span');
        date.className = 'clan-comment-date';
        date.textContent = formatClanFullDate(comment.created_at);
        head.appendChild(nick);
        head.appendChild(date);

        const text = document.createElement('p');
        text.className = 'clan-comment-text';
        text.textContent = comment.content;

        body.appendChild(head);
        body.appendChild(text);
        item.appendChild(avatar);
        item.appendChild(body);
        clanCommentsList.appendChild(item);
      });

      renderClanPagination(clanCommentPagination, data.pagination, (newPage) => {
        loadClanBoardComments(postId, newPage);
      });
    } catch (_) { /* ignore */ }
  }

  clanDetailWriteBtn?.addEventListener('click', () => {
    openClanWriteForm();
  });

  clanDetailEditBtn?.addEventListener('click', () => {
    if (!clanBoardCurrentPostData) return;
    openClanWriteFormForEdit(clanBoardCurrentPostData);
  });

  clanDetailDeleteBtn?.addEventListener('click', async () => {
    if (!clanBoardCurrentPostId) return;
    if (!window.confirm('이 게시물을 삭제하시겠습니까?')) return;
    clanDetailDeleteBtn.disabled = true;
    try {
      const res = await fetch(`/api/clan-board/posts/${encodeURIComponent(clanBoardCurrentPostId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || '게시물을 삭제하지 못했습니다.');
        return;
      }
      navigateToClanBoard();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.');
    } finally {
      clanDetailDeleteBtn.disabled = false;
    }
  });

  clanLikeBtn?.addEventListener('click', async () => {
    if (!clanBoardCurrentPostId || clanLikeBtn.disabled) return;
    clanLikeBtn.disabled = true;
    try {
      const res = await fetch(`/api/clan-board/posts/${encodeURIComponent(clanBoardCurrentPostId)}/likes`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          window.alert(data.error || '로그인이 필요합니다.');
        } else {
          window.alert(data.error || '처리 중 오류가 발생했습니다.');
        }
        return;
      }
      clanBoardCurrentPostLiked = data.liked;
      clanLikeBtn.classList.toggle('is-liked', !!data.liked);
      clanLikeText.textContent = data.liked ? '추천 취소' : '추천';
      clanLikeCount.textContent = String(data.like_count);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '네트워크 오류가 발생했습니다.');
    } finally {
      clanLikeBtn.disabled = false;
    }
  });

  clanCatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      clanBoardCategory = btn.dataset.category;
      clanBoardPage = 1;
      updateClanCategoryActive();
      loadClanBoardPosts();
    });
  });

  const clanBoardBottomSearch = document.getElementById('clan-board-bottom-search');
  const clanBoardBottomSearchBtn = document.getElementById('clan-board-bottom-search-btn');

  clanBoardBottomSearchBtn?.addEventListener('click', () => {
    clanBoardSearchText = (clanBoardBottomSearch?.value || '').trim();
    clanBoardPage = 1;
    loadClanBoardPosts();
  });

  clanBoardBottomSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clanBoardSearchText = (clanBoardBottomSearch?.value || '').trim();
      clanBoardPage = 1;
      loadClanBoardPosts();
    }
  });

  /* 글쓰기 */

  let clanBoardPreviousSubBoard = 'clan-fullauto';
  const clanWritePanel = document.querySelector('[data-board-panel="clan-write"]');

  function getClanBoardNameDisplay() {
    const activeNav = links.find((b) => b.classList.contains('is-active'));
    const board = activeNav?.dataset.board || clanBoardPreviousSubBoard || 'clan-fullauto';
    if (board === 'clan-semi') return '클랜전 게시판 — 세미오토';
    if (board === 'clan-fullauto') return '클랜전 게시판 — 플오토';
    return '클랜전 게시판';
  }

  function resetClanWriteEditingState() {
    clanBoardEditingPostId = null;
    if (clanWriteSubmit) clanWriteSubmit.textContent = '작성';
  }

  function openClanWriteFormForEdit(post) {
    if (sessionUserRole === 'guest') {
      openLoginModal();
      return;
    }
    if (!post?.can_edit) return;
    clanBoardEditingPostId = post.id;
    openClanWriteForm();
    clanWriteCategory = post.category || 'none';
    if (clanWriteCategorySelect) clanWriteCategorySelect.value = clanWriteCategory;
    if (clanWriteTitle) clanWriteTitle.value = post.title || '';
    if (clanWriteContent) clanWriteContent.innerHTML = post.content || '';
    if (clanWriteSubmit) clanWriteSubmit.textContent = '수정';
    if (clanWriteTitleWarning) clanWriteTitleWarning.hidden = true;
    if (clanWriteError) { clanWriteError.hidden = true; clanWriteError.textContent = ''; }
  }

  function openClanWriteForm() {
    if (sessionUserRole === 'guest') {
      openLoginModal();
      return;
    }
    const activeNav = links.find((b) => b.classList.contains('is-active'));
    clanBoardPreviousSubBoard = activeNav ? activeNav.dataset.board : 'clan-fullauto';
    if (!clanBoardEditingPostId) resetClanWriteEditingState();

    panels.forEach((panel) => {
      const match = panel.dataset.boardPanel === 'clan-write';
      panel.hidden = !match;
      panel.classList.toggle('is-visible', match);
    });
    links.forEach((btn) => {
      btn.classList.remove('is-active');
      btn.removeAttribute('aria-current');
    });
    document.body.classList.remove('is-mypage-route');
    requestAnimationFrame(() => moveUnderline(null));

    if (!clanBoardEditingPostId) {
      clanWriteForm.reset();
      clanWriteCategory = 'none';
      if (clanWriteCategorySelect) clanWriteCategorySelect.value = 'none';
      if (clanWriteFontsize) clanWriteFontsize.value = '12';
      if (clanWriteContent) clanWriteContent.innerHTML = '';
    }
    if (clanWriteError) { clanWriteError.hidden = true; clanWriteError.textContent = ''; }
    if (clanWriteTitleWarning) clanWriteTitleWarning.hidden = true;
    if (clanWriteLinkPopup) clanWriteLinkPopup.hidden = true;
    if (clanWriteBoardName) clanWriteBoardName.textContent = getClanBoardNameDisplay();
    if (clanWriteTitle) clanWriteTitle.focus();
  }

  function closeClanWriteForm() {
    resetClanWriteEditingState();
    setActiveBoard(clanBoardPreviousSubBoard);
  }

  function execWriteCommand(command, value) {
    if (!clanWriteContent) return;
    clanWriteContent.focus();
    document.execCommand(command, false, value || null);
  }

  function insertNodeAtCursor(node) {
    if (!clanWriteContent || !node) return;
    clanWriteContent.focus();
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      clanWriteContent.appendChild(node);
    }
  }

  function insertNodeAtCursor(node) {
    if (!clanWriteContent || !node) return;
    clanWriteContent.focus();
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      clanWriteContent.appendChild(node);
    }
  }

  const TACTIC_STAR_GRADE_MIN = 1;
  const TACTIC_STAR_GRADE_MAX = 6;
  const TACTIC_STAR_GRADE_DEFAULT = 3;

  function buildStarGradeIcons(grade) {
    const wrap = document.createElement('span');
    wrap.className = 'clan-tactic-table__star-grade-icons';
    wrap.dataset.grade = String(grade);
    wrap.setAttribute('aria-hidden', 'true');

    const g = Math.min(TACTIC_STAR_GRADE_MAX, Math.max(TACTIC_STAR_GRADE_MIN, grade));
    if (g <= 5) {
      for (let i = 0; i < 5; i += 1) {
        const star = document.createElement('span');
        star.className = i < g
          ? 'clan-tactic-table__sg-star clan-tactic-table__sg-star--filled'
          : 'clan-tactic-table__sg-star clan-tactic-table__sg-star--empty';
        star.textContent = '\u2605';
        wrap.appendChild(star);
      }
    } else {
      for (let i = 0; i < 5; i += 1) {
        const star = document.createElement('span');
        star.className = 'clan-tactic-table__sg-star clan-tactic-table__sg-star--filled';
        star.textContent = '\u2605';
        wrap.appendChild(star);
      }
      const pinkStar = document.createElement('span');
      pinkStar.className = 'clan-tactic-table__sg-star clan-tactic-table__sg-star--pink';
      pinkStar.textContent = '\u2605';
      wrap.appendChild(pinkStar);
    }
    return wrap;
  }

  function createStarGradeDial(initialGrade = TACTIC_STAR_GRADE_DEFAULT) {
    const dial = document.createElement('div');
    dial.className = 'clan-tactic-table__star-grade-dial';
    dial.contentEditable = 'false';

    let grade = Math.min(TACTIC_STAR_GRADE_MAX, Math.max(TACTIC_STAR_GRADE_MIN, initialGrade));

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'clan-tactic-table__star-grade-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', `${grade}\uC131 \uC120\uD0DD`);

    const chevron = document.createElement('span');
    chevron.className = 'clan-tactic-table__star-grade-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '\u25BE';

    const menu = document.createElement('ul');
    menu.className = 'clan-tactic-table__star-grade-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = 'clan-tactic-table__star-grade-value';
    hiddenInput.value = String(grade);
    hiddenInput.contentEditable = 'false';

    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }

    function setGrade(nextGrade) {
      grade = Math.min(TACTIC_STAR_GRADE_MAX, Math.max(TACTIC_STAR_GRADE_MIN, nextGrade));
      hiddenInput.value = String(grade);
      trigger.setAttribute('aria-label', `${grade}\uC131 \uC120\uD0DD`);
      const currentLabel = trigger.querySelector('.clan-tactic-table__star-grade-label');
      if (currentLabel) currentLabel.textContent = `${grade}\uC131`;
      menu.querySelectorAll('.clan-tactic-table__star-grade-option').forEach((btn) => {
        btn.classList.toggle('is-selected', Number(btn.dataset.grade) === grade);
      });
      closeMenu();
    }

    function renderTriggerLabel() {
      const existing = trigger.querySelector('.clan-tactic-table__star-grade-label');
      if (existing) existing.textContent = `${grade}\uC131`;
      else if (trigger.contains(chevron)) {
        const label = document.createElement('span');
        label.className = 'clan-tactic-table__star-grade-label';
        label.textContent = `${grade}\uC131`;
        trigger.insertBefore(label, chevron);
      } else {
        const label = document.createElement('span');
        label.className = 'clan-tactic-table__star-grade-label';
        label.textContent = `${grade}\uC131`;
        trigger.appendChild(label);
      }
    }

    for (let g = TACTIC_STAR_GRADE_MIN; g <= TACTIC_STAR_GRADE_MAX; g += 1) {
      const item = document.createElement('li');
      item.className = 'clan-tactic-table__star-grade-item';
      item.setAttribute('role', 'presentation');

      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'clan-tactic-table__star-grade-option';
      option.dataset.grade = String(g);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', g === grade ? 'true' : 'false');
      if (g === grade) option.classList.add('is-selected');
      const numSpan = document.createElement('span');
      numSpan.className = 'clan-tactic-table__star-grade-number';
      numSpan.textContent = String(g);
      option.appendChild(numSpan);
      option.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setGrade(g);
        option.setAttribute('aria-selected', 'true');
        menu.querySelectorAll('.clan-tactic-table__star-grade-option').forEach((btn) => {
          btn.setAttribute('aria-selected', btn === option ? 'true' : 'false');
        });
      });

      item.appendChild(option);
      menu.appendChild(item);
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    dial.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    const onDocumentClick = (e) => {
      if (!dial.contains(e.target)) closeMenu();
    };
    document.addEventListener('click', onDocumentClick);
    dial._starGradeDocCleanup = () => document.removeEventListener('click', onDocumentClick);

    trigger.appendChild(chevron);
    renderTriggerLabel();
    dial.appendChild(trigger);
    dial.appendChild(menu);
    dial.appendChild(hiddenInput);
    return dial;
  }

  function getTacticStarGradeCell(charCell) {
    const slot = charCell?.dataset?.tacticSlot;
    if (!slot) return null;
    const table = charCell.closest('.clan-tactic-table');
    if (!table) return null;
    return table.querySelector(`.clan-tactic-table__star-grade-cell[data-tactic-slot="${slot}"]`);
  }

  function showTacticStarGradeDial(charCell) {
    const gradeCell = getTacticStarGradeCell(charCell);
    if (!gradeCell) return;

    let slot = gradeCell.querySelector('.clan-tactic-table__star-grade-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'clan-tactic-table__star-grade-slot';
      slot.contentEditable = 'false';
      gradeCell.appendChild(slot);
    }

    if (!slot.querySelector('.clan-tactic-table__star-grade-dial')) {
      slot.appendChild(createStarGradeDial());
    }

    slot.hidden = false;
    gradeCell.classList.add('clan-tactic-table__star-grade-cell--active');
  }

  function hideTacticStarGradeDial(charCell) {
    const gradeCell = getTacticStarGradeCell(charCell);
    if (!gradeCell) return;

    const slot = gradeCell.querySelector('.clan-tactic-table__star-grade-slot');
    if (slot) {
      slot.querySelectorAll('.clan-tactic-table__star-grade-dial').forEach((dial) => {
        if (typeof dial._starGradeDocCleanup === 'function') dial._starGradeDocCleanup();
      });
      slot.innerHTML = '';
      slot.hidden = true;
    }
    gradeCell.classList.remove('clan-tactic-table__star-grade-cell--active');
  }

  function getTacticRankCell(charCell) {
    const slot = charCell?.dataset?.tacticSlot;
    if (!slot) return null;
    const table = charCell.closest('.clan-tactic-table');
    if (!table) return null;
    return table.querySelector(`.clan-tactic-table__rank-input-cell[data-tactic-slot="${slot}"]`);
  }

  function createRankInput() {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'clan-tactic-table__rank-input';
    input.placeholder = 'RANK \uC785\uB825';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 12;
    input.addEventListener('input', () => {
      const sanitized = input.value.replace(/[^0-9+\-]/g, '');
      if (input.value !== sanitized) input.value = sanitized;
    });
    input.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    return input;
  }

  function showTacticRankInput(charCell) {
    const rankCell = getTacticRankCell(charCell);
    if (!rankCell) return;

    let slot = rankCell.querySelector('.clan-tactic-table__rank-input-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'clan-tactic-table__rank-input-slot';
      slot.contentEditable = 'false';
      rankCell.appendChild(slot);
    }

    if (!slot.querySelector('.clan-tactic-table__rank-input')) {
      slot.appendChild(createRankInput());
    }

    slot.hidden = false;
    rankCell.classList.add('clan-tactic-table__rank-input-cell--active');
  }

  function hideTacticRankInput(charCell) {
    const rankCell = getTacticRankCell(charCell);
    if (!rankCell) return;

    const slot = rankCell.querySelector('.clan-tactic-table__rank-input-slot');
    if (slot) {
      slot.innerHTML = '';
      slot.hidden = true;
    }
    rankCell.classList.remove('clan-tactic-table__rank-input-cell--active');
  }

  function showTacticCharSlotExtras(charCell) {
    showTacticStarGradeDial(charCell);
    showTacticRankInput(charCell);
  }

  function hideTacticCharSlotExtras(charCell) {
    hideTacticStarGradeDial(charCell);
    hideTacticRankInput(charCell);
  }

  const TACTIC_TIME_MAX_TOTAL_SEC = 91;
  const TACTIC_IMAGE_SIZE = 75;

  function createTacticTimeInput() {
    const wrap = document.createElement('div');
    wrap.className = 'clan-tactic-table__time-input';
    wrap.contentEditable = 'false';

    const minInput = document.createElement('input');
    minInput.type = 'text';
    minInput.className = 'clan-tactic-table__time-part clan-tactic-table__time-min';
    minInput.inputMode = 'numeric';
    minInput.autocomplete = 'off';
    minInput.spellcheck = false;
    minInput.maxLength = 1;
    minInput.setAttribute('aria-label', '\uBD84');

    const sep = document.createElement('span');
    sep.className = 'clan-tactic-table__time-sep';
    sep.textContent = ':';
    sep.setAttribute('aria-hidden', 'true');

    const secInput = document.createElement('input');
    secInput.type = 'text';
    secInput.className = 'clan-tactic-table__time-part clan-tactic-table__time-sec';
    secInput.inputMode = 'numeric';
    secInput.autocomplete = 'off';
    secInput.spellcheck = false;
    secInput.maxLength = 2;
    secInput.setAttribute('aria-label', '\uCD08');

    function stopEditBubble(e) {
      e.stopPropagation();
    }

    function clampAndApply(formatSec) {
      const minDigits = minInput.value.replace(/[^0-9]/g, '').slice(0, 1);
      const secDigits = secInput.value.replace(/[^0-9]/g, '').slice(0, 2);
      let min = minDigits === '' ? 0 : parseInt(minDigits, 10);
      let sec = secDigits === '' ? 0 : parseInt(secDigits, 10);
      if (Number.isNaN(min)) min = 0;
      if (Number.isNaN(sec)) sec = 0;

      if (min > 1) min = 1;
      if (min === 1) {
        sec = Math.min(sec, 31);
      } else {
        sec = Math.min(sec, 59);
      }

      const total = min * 60 + sec;
      if (total > TACTIC_TIME_MAX_TOTAL_SEC) {
        min = 1;
        sec = 31;
      }

      if (minDigits === '' && !formatSec) {
        minInput.value = '';
      } else {
        minInput.value = String(min);
      }

      if (secDigits === '' && !formatSec) {
        secInput.value = '';
      } else if (formatSec) {
        secInput.value = String(sec).padStart(2, '0');
      } else {
        secInput.value = String(sec);
      }
    }

    minInput.addEventListener('input', () => clampAndApply(false));
    secInput.addEventListener('input', () => clampAndApply(false));
    minInput.addEventListener('blur', () => clampAndApply(true));
    secInput.addEventListener('blur', () => clampAndApply(true));
    [minInput, secInput, wrap].forEach((el) => {
      el.addEventListener('mousedown', stopEditBubble);
      el.addEventListener('click', stopEditBubble);
    });

    wrap.appendChild(minInput);
    wrap.appendChild(sep);
    wrap.appendChild(secInput);
    return wrap;
  }

  function isEffectivelyEmptyEditable(el) {
    return (el.textContent || '').replace(/\u200B/g, '').trim() === '';
  }

  function bindTacticAutoCell(cell) {
    function stopEditBubble(e) {
      e.stopPropagation();
    }

    cell.addEventListener('mousedown', stopEditBubble);
    cell.addEventListener('click', stopEditBubble);

    cell.addEventListener('focus', () => {
      if (!isEffectivelyEmptyEditable(cell)) return;

      let editRoot = cell.querySelector('.clan-tactic-table__auto-cell-edit');
      const firstChild = cell.firstElementChild;
      if (!editRoot && firstChild?.tagName === 'DIV' && isEffectivelyEmptyEditable(firstChild)) {
        firstChild.classList.add('clan-tactic-table__auto-cell-edit');
        editRoot = firstChild;
      }
      if (!editRoot) {
        cell.textContent = '';
        editRoot = document.createElement('div');
        editRoot.className = 'clan-tactic-table__auto-cell-edit';
        editRoot.appendChild(document.createElement('br'));
        cell.appendChild(editRoot);
      }

      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || !editRoot) return;
        const range = document.createRange();
        range.selectNodeContents(editRoot);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });
  }

  function createTacticInputRow() {
    const tr = document.createElement('tr');
    tr.className = 'clan-tactic-table__row';

    // 0열: ':'  (좁은 열, 80px)
    const sepCell = document.createElement('td');
    sepCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__sep-cell';
    sepCell.contentEditable = 'false';
    sepCell.textContent = ':';
    tr.appendChild(sepCell);

    // 1-2열: '텍틱을 입력하세요.' (colSpan=2)
    const tacticTextCell = document.createElement('td');
    tacticTextCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__tactic-text-cell';
    tacticTextCell.colSpan = 2;
    tacticTextCell.contentEditable = 'true';
    tacticTextCell.dataset.placeholder = '\uD14D\uD2F1\uC744 \uC785\uB825\uD558\uC138\uC694.';
    tr.appendChild(tacticTextCell);

    // 3-7열: '오토여부' ×5
    for (let col = 3; col <= 7; col += 1) {
      const cell = document.createElement('td');
      cell.className = 'clan-tactic-table__grid-cell clan-tactic-table__auto-cell';
      cell.contentEditable = 'true';
      cell.dataset.placeholder = '\uC624\uD1A0\uC5EC\uBD80';
      bindTacticAutoCell(cell);
      tr.appendChild(cell);
    }

    return tr;
  }

  function createTacticTableElement() {
    const wrap = document.createElement('div');
    wrap.className = 'clan-tactic-table-wrap';

    const table = document.createElement('table');
    table.className = 'clan-tactic-table';

    const tbody = document.createElement('tbody');

    const THEME_COLORS = ['#F06292', '#8BC34A', '#FFEB3B', '#7B1FA2', '#03A9F4'];
    let currentTheme = 1;

    function applyTheme(themeRow, themeNum) {
      currentTheme = themeNum;
      if (themeRow) {
        themeRow.style.background = THEME_COLORS[themeNum - 1];
      }
    }

    // 0행: 테마 선택
    const themeRow = document.createElement('tr');
    themeRow.className = 'clan-tactic-table__theme-row';
    const themeCell = document.createElement('td');
    themeCell.colSpan = 8;
    themeCell.contentEditable = 'false';

    const themeInner = document.createElement('div');
    themeInner.className = 'clan-tactic-table__theme-inner';

    const themeSelect = document.createElement('select');
    themeSelect.className = 'clan-tactic-table__theme-select';
    themeSelect.setAttribute('aria-label', '\uD14D\uD2F1 \uD14C\uB9C8 \uC120\uD0DD');
    for (let i = 1; i <= 5; i += 1) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `\uD14D\uD2F1 \uD14C\uB9C8 ${i}`;
      themeSelect.appendChild(opt);
    }
    themeSelect.value = '1';
    themeSelect.addEventListener('change', () => {
      applyTheme(themeRow, Number(themeSelect.value));
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'clan-tactic-table__delete-btn';
    deleteBtn.textContent = '\uC0AD\uC81C';
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.remove();
    });

    themeInner.appendChild(themeSelect);
    themeInner.appendChild(deleteBtn);
    themeCell.appendChild(themeInner);
    themeRow.appendChild(themeCell);
    applyTheme(themeRow, 1);
    tbody.appendChild(themeRow);

    // 1행: 헤더 (보스 이미지 + 캐릭터 추가 × 5)
    const tr1 = document.createElement('tr');
    tr1.className = 'clan-tactic-table__row clan-tactic-table__row--head';

    // 0-1열: 데미지 입력 (colSpan=2)  →  80px + 130px = 210px
    const dmgCell = document.createElement('td');
    dmgCell.className = 'clan-tactic-table__main-cell';
    dmgCell.colSpan = 2;
    dmgCell.contentEditable = 'false';

    const dmgInput = document.createElement('input');
    dmgInput.type = 'text';
    dmgInput.className = 'clan-tactic-table__damage-input';
    dmgInput.placeholder = '\uD14D\uD2F1 \uB370\uBBF8\uC9C0\uB97C \uC785\uB825\uD558\uC138\uC694.';
    dmgInput.inputMode = 'numeric';
    dmgInput.autocomplete = 'off';
    dmgInput.addEventListener('input', () => {
      let raw = dmgInput.value.replace(/[^0-9]/g, '');
      if (raw.length > 10) raw = raw.slice(0, 10);
      if (raw === '') {
        dmgInput.value = '';
      } else {
        const num = parseInt(raw, 10);
        dmgInput.value = num.toLocaleString('ko-KR');
      }
    });
    dmgCell.appendChild(dmgInput);
    tr1.appendChild(dmgCell);

    // 2열: 보스 이미지
    const bossCell = document.createElement('td');
    bossCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__grid-cell--head clan-tactic-table__boss-cell';
    bossCell.contentEditable = 'false';
    const bossBtn = document.createElement('button');
    bossBtn.type = 'button';
    bossBtn.className = 'clan-tactic-table__boss-btn';
    bossBtn.innerHTML = '<span class="clan-tactic-table__slot-label">\uBCF4\uC2A4 \uC774\uBBF8\uC9C0</span>';
    bossBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById('clan-write-boss-image-input');
      if (input) {
        input._bossTargetCell = bossCell;
        input.click();
      }
    });
    bossCell.appendChild(bossBtn);
    tr1.appendChild(bossCell);

    // 3-7열: 캐릭터 추가 × 5
    for (let col = 3; col <= 7; col += 1) {
      const cell = document.createElement('td');
      cell.className = 'clan-tactic-table__grid-cell clan-tactic-table__grid-cell--head clan-tactic-table__char-cell';
      cell.contentEditable = 'false';
      cell.dataset.tacticSlot = String(col - 2);
      const charBtn = createCharImageButton(cell);
      if (charBtn) cell.appendChild(charBtn);
      tr1.appendChild(cell);
    }
    tbody.appendChild(tr1);

    // 2행: 보스명 입력
    const tr2 = document.createElement('tr');
    tr2.className = 'clan-tactic-table__row';

    // 0-1열: 데미지 입력의 보스 영역 (colSpan=2, 빈 셀 - 경계선 유지)
    const dmgPlaceholder2 = document.createElement('td');
    dmgPlaceholder2.className = 'clan-tactic-table__main-cell clan-tactic-table__main-cell--placeholder';
    dmgPlaceholder2.colSpan = 2;
    dmgPlaceholder2.contentEditable = 'false';
    tr2.appendChild(dmgPlaceholder2);

    // 2열: 보스명 입력
    const bossNameCell = document.createElement('td');
    bossNameCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__name-cell';
    bossNameCell.contentEditable = 'false';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'clan-tactic-table__bossname-input';
    nameInput.placeholder = '\uBCF4\uC2A4\uBA85 \uC785\uB825';
    nameInput.maxLength = 8;
    nameInput.autocomplete = 'off';
    bossNameCell.appendChild(nameInput);
    tr2.appendChild(bossNameCell);

    for (let col = 3; col <= 7; col += 1) {
      const cell = document.createElement('td');
      cell.className = 'clan-tactic-table__grid-cell clan-tactic-table__char-name-cell';
      cell.dataset.tacticSlot = String(col - 2);
      cell.contentEditable = 'false';
      cell.dataset.placeholder = '\uCE90\uB9AD\uD130\uBA85';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'clan-tactic-table__char-name-text';
      cell.appendChild(nameSpan);
      tr2.appendChild(cell);
    }
    tbody.appendChild(tr2);

    // 3행: 캐릭터 성급
    const tr3 = document.createElement('tr');
    tr3.className = 'clan-tactic-table__row';

    // 0-1열: 데미지 입력의 보스 영역 (colSpan=2, 빈 셀 - 경계선 유지)
    const dmgPlaceholder3 = document.createElement('td');
    dmgPlaceholder3.className = 'clan-tactic-table__main-cell clan-tactic-table__main-cell--placeholder';
    dmgPlaceholder3.colSpan = 2;
    dmgPlaceholder3.contentEditable = 'false';
    tr3.appendChild(dmgPlaceholder3);

    // 2열: 캐릭터 성급 라벨
    const charGradeLabelCell = document.createElement('td');
    charGradeLabelCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__star-cell clan-tactic-table__no-edit';
    charGradeLabelCell.contentEditable = 'false';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'clan-tactic-table__star-label';
    labelSpan.textContent = '\uCE90\uB9AD\uD130 \uC131\uAE09';
    labelSpan.contentEditable = 'false';
    charGradeLabelCell.appendChild(labelSpan);
    tr3.appendChild(charGradeLabelCell);

    for (let col = 3; col <= 7; col += 1) {
      const cell = document.createElement('td');
      cell.className = 'clan-tactic-table__grid-cell clan-tactic-table__star-grade-cell';
      cell.dataset.tacticSlot = String(col - 2);
      cell.contentEditable = 'false';
      tr3.appendChild(cell);
    }
    tbody.appendChild(tr3);

    // 4행: RANK
    const tr4 = document.createElement('tr');
    tr4.className = 'clan-tactic-table__row';

    // 0-1열: 데미지 입력의 보스 영역 (colSpan=2, 빈 셀 - 경계선 유지)
    const dmgPlaceholder4 = document.createElement('td');
    dmgPlaceholder4.className = 'clan-tactic-table__main-cell clan-tactic-table__main-cell--placeholder';
    dmgPlaceholder4.colSpan = 2;
    dmgPlaceholder4.contentEditable = 'false';
    tr4.appendChild(dmgPlaceholder4);

    // 2열: RANK 라벨
    const rankLabelCell = document.createElement('td');
    rankLabelCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__rank-cell clan-tactic-table__no-edit';
    rankLabelCell.contentEditable = 'false';
    const rankSpan = document.createElement('span');
    rankSpan.className = 'clan-tactic-table__rank-text';
    rankSpan.textContent = 'RANK';
    rankSpan.contentEditable = 'false';
    rankLabelCell.appendChild(rankSpan);
    tr4.appendChild(rankLabelCell);

    for (let col = 3; col <= 7; col += 1) {
      const cell = document.createElement('td');
      cell.className = 'clan-tactic-table__grid-cell clan-tactic-table__rank-input-cell';
      cell.dataset.tacticSlot = String(col - 2);
      cell.contentEditable = 'false';
      tr4.appendChild(cell);
    }
    tbody.appendChild(tr4);

    // 5행: 구분 행 (타임라인 + 오토여부)
    const tr5 = createTacticInputRow();
    tbody.appendChild(tr5);

    // 6행: 추가 버튼 행
    const tr6 = document.createElement('tr');
    tr6.className = 'clan-tactic-table__row';

    const addCell = document.createElement('td');
    addCell.className = 'clan-tactic-table__grid-cell clan-tactic-table__add-cell';
    addCell.colSpan = 8;
    addCell.contentEditable = 'false';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'clan-tactic-table__add-tactic-btn';
    addBtn.textContent = '+ \uD14D\uD2F1 \uCD94\uAC00';
    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newRow = createTacticInputRow();
      tbody.insertBefore(newRow, tr6);
    });

    addCell.appendChild(addBtn);
    tr6.appendChild(addCell);
    tbody.appendChild(tr6);

    const colgroup = document.createElement('colgroup');
    const colNarrow = document.createElement('col');
    colNarrow.className = 'clan-tactic-table__col-narrow';
    const colLabel = document.createElement('col');
    colLabel.className = 'clan-tactic-table__col-label';
    const colBoss = document.createElement('col');
    colBoss.className = 'clan-tactic-table__col-boss';
    const colChars = document.createElement('col');
    colChars.span = 5;
    colChars.className = 'clan-tactic-table__col-slot';
    colgroup.appendChild(colNarrow);
    colgroup.appendChild(colLabel);
    colgroup.appendChild(colBoss);
    colgroup.appendChild(colChars);
    table.appendChild(colgroup);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function insertFileAtCursor(file, type) {
    if (!clanWriteContent) return;
    const reader = new FileReader();
    reader.onload = () => {
      const el = document.createElement(type === 'video' ? 'video' : 'img');
      el.src = reader.result;
      if (type === 'video') el.setAttribute('controls', '');
      el.style.maxWidth = '100%';
      const brBefore = document.createElement('br');
      const brAfter = document.createElement('br');
      const frag = document.createDocumentFragment();
      frag.appendChild(brBefore);
      frag.appendChild(el);
      frag.appendChild(brAfter);
      insertNodeAtCursor(frag);
    };
    reader.readAsDataURL(file);
  }

  clanWriteOpenBtn?.addEventListener('click', () => { openClanWriteForm(); });

  clanWriteCategorySelect?.addEventListener('change', () => {
    clanWriteCategory = clanWriteCategorySelect.value;
  });

  clanWriteBack?.addEventListener('click', () => { closeClanWriteForm(); });
  clanWriteCancel?.addEventListener('click', () => { closeClanWriteForm(); });

  clanWriteTitle?.addEventListener('input', () => {
    if (!clanWriteTitleWarning) return;
    const len = [...clanWriteTitle.value].length;
    if (len > 30) {
      clanWriteTitleWarning.hidden = false;
      clanWriteTitle.style.borderColor = '#dc2626';
    } else {
      clanWriteTitleWarning.hidden = true;
      clanWriteTitle.style.borderColor = '';
    }
  });

  clanWriteTitle?.addEventListener('blur', () => {
    if (clanWriteTitle) clanWriteTitle.style.borderColor = '';
  });

  clanWriteBtnImage?.addEventListener('click', () => {
    clanWriteImageInput?.click();
  });

  clanWriteImageInput?.addEventListener('change', () => {
    const file = clanWriteImageInput?.files?.[0];
    if (file) insertFileAtCursor(file, 'image');
    if (clanWriteImageInput) clanWriteImageInput.value = '';
  });

  clanWriteBtnVideo?.addEventListener('click', () => {
    clanWriteVideoInput?.click();
  });

  clanWriteVideoInput?.addEventListener('change', () => {
    const file = clanWriteVideoInput?.files?.[0];
    if (file) insertFileAtCursor(file, 'video');
    if (clanWriteVideoInput) clanWriteVideoInput.value = '';
  });

  clanWriteBtnLink?.addEventListener('click', () => {
    if (clanWriteLinkPopup) clanWriteLinkPopup.hidden = false;
    if (clanWriteLinkInput) {
      clanWriteLinkInput.value = '';
      clanWriteLinkInput.focus();
    }
  });

  function isInsideTacticNoEditCell(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (el?.closest?.('.clan-tactic-table__star-grade-dial')) return false;
    if (el?.closest?.('.clan-tactic-table__rank-input')) return false;
    if (el?.closest?.('.clan-tactic-table__time-part')) return false;
    if (el?.closest?.('.clan-tactic-table__time-input')) return false;
    if (el?.closest?.('.clan-tactic-table__star-grade-cell')) return true;
    if (el?.closest?.('.clan-tactic-table__rank-input-cell')) return true;
    return Boolean(el?.closest?.('.clan-tactic-table__no-edit'));
  }

  function blockTacticNoEditInput(e) {
    const sel = window.getSelection();
    if (!isInsideTacticNoEditCell(e.target) && !isInsideTacticNoEditCell(sel?.anchorNode)) return;
    e.preventDefault();
  }

  clanWriteContent?.addEventListener('beforeinput', blockTacticNoEditInput);
  clanWriteContent?.addEventListener('paste', blockTacticNoEditInput);
  clanWriteContent?.addEventListener('keydown', (e) => {
    const sel = window.getSelection();
    if (!isInsideTacticNoEditCell(sel?.anchorNode)) return;
    const blocked = e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter';
    if (blocked && !e.ctrlKey && !e.metaKey) e.preventDefault();
  });

  clanWriteBtnTactic?.addEventListener('click', () => {
    const tbl = createTacticTableElement();
    const brBefore = document.createElement('br');
    const brAfter = document.createElement('br');
    const frag = document.createDocumentFragment();
    frag.appendChild(brBefore);
    frag.appendChild(tbl);
    frag.appendChild(brAfter);
    insertNodeAtCursor(frag);
  });

  clanWriteLinkCancel?.addEventListener('click', () => {
    if (clanWriteLinkPopup) clanWriteLinkPopup.hidden = true;
  });

  clanWriteLinkInsert?.addEventListener('click', () => {
    const url = (clanWriteLinkInput?.value || '').trim();
    if (!url) return;
    if (clanWriteLinkPopup) clanWriteLinkPopup.hidden = true;
    if (!clanWriteContent) return;
    clanWriteContent.focus();
    const text = document.createTextNode(url);
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.getRangeAt(0).collapsed) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(text);
      range.setStartAfter(text);
      range.setEndAfter(text);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      clanWriteContent.appendChild(text);
    }
  });

  clanWriteLinkInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clanWriteLinkInsert?.click();
    }
  });

  clanWriteFontsize?.addEventListener('change', () => {
    execWriteCommand('fontSize', clanWriteFontsize.value);
  });

  clanWriteBtnBold?.addEventListener('click', () => { execWriteCommand('bold'); });
  clanWriteBtnItalic?.addEventListener('click', () => { execWriteCommand('italic'); });
  clanWriteBtnUnderline?.addEventListener('click', () => { execWriteCommand('underline'); });
  clanWriteBtnStrike?.addEventListener('click', () => { execWriteCommand('strikeThrough'); });

  clanWriteForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (clanWriteSubmit) clanWriteSubmit.disabled = true;
    if (clanWriteError) { clanWriteError.hidden = true; clanWriteError.textContent = ''; }
    if (clanWriteLinkPopup) clanWriteLinkPopup.hidden = true;

    const title = (clanWriteTitle?.value || '').trim();
    const htmlContent = clanWriteContent?.innerHTML || '';
    const textContent = (clanWriteContent?.textContent || '').trim();

    if (!title) {
      if (clanWriteError) { clanWriteError.textContent = '제목을 입력해 주세요.'; clanWriteError.hidden = false; }
      clanWriteSubmit.disabled = false;
      clanWriteTitle?.focus();
      return;
    }

    const titleLen = [...title].length;
    if (titleLen > 30) {
      if (clanWriteError) { clanWriteError.textContent = '게시물 제목은 30자 이내로만 작성 가능합니다.'; clanWriteError.hidden = false; }
      if (clanWriteTitleWarning) clanWriteTitleWarning.hidden = false;
      clanWriteSubmit.disabled = false;
      clanWriteTitle?.focus();
      return;
    }

    if (!textContent) {
      if (clanWriteError) { clanWriteError.textContent = '내용을 입력해 주세요.'; clanWriteError.hidden = false; }
      clanWriteSubmit.disabled = false;
      clanWriteContent?.focus();
      return;
    }

    try {
      const editingId = clanBoardEditingPostId;
      const endpoint = editingId
        ? `/api/clan-board/posts/${encodeURIComponent(editingId)}`
        : '/api/clan-board/posts';
      const res = await fetch(endpoint, {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: htmlContent, category: clanWriteCategory }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          if (clanWriteError) { clanWriteError.textContent = data.error || '로그인이 필요합니다.'; clanWriteError.hidden = false; }
        } else {
          const fallback = editingId ? '게시물 수정 중 오류가 발생했습니다.' : '게시물 작성 중 오류가 발생했습니다.';
          if (clanWriteError) { clanWriteError.textContent = data.error || fallback; clanWriteError.hidden = false; }
        }
        return;
      }
      const postId = editingId || data.id;
      resetClanWriteEditingState();
      closeClanWriteForm();
      await openClanPostDetail(postId);
    } catch (err) {
      if (clanWriteError) { clanWriteError.textContent = err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.'; clanWriteError.hidden = false; }
    } finally {
      if (clanWriteSubmit) clanWriteSubmit.disabled = false;
    }
  });

  /* 댓글 작성 */

  function showClanCommentForm() {
    if (clanCommentWriteForm) {
      clanCommentWriteForm.hidden = sessionUserRole === 'guest';
    }
  }

  function resetClanCommentForm() {
    if (clanCommentInput) clanCommentInput.value = '';
    if (clanCommentError) { clanCommentError.hidden = true; clanCommentError.textContent = ''; }
  }

  clanCommentWriteForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!clanBoardCurrentPostId) return;
    if (clanCommentSubmit) clanCommentSubmit.disabled = true;
    if (clanCommentError) { clanCommentError.hidden = true; clanCommentError.textContent = ''; }

    const content = (clanCommentInput?.value || '').trim();
    if (!content) {
      if (clanCommentError) { clanCommentError.textContent = '댓글 내용을 입력해 주세요.'; clanCommentError.hidden = false; }
      if (clanCommentSubmit) clanCommentSubmit.disabled = false;
      return;
    }

    try {
      const res = await fetch(`/api/clan-board/posts/${encodeURIComponent(clanBoardCurrentPostId)}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (clanCommentError) { clanCommentError.textContent = data.error || '댓글 작성 중 오류가 발생했습니다.'; clanCommentError.hidden = false; }
        return;
      }
      resetClanCommentForm();
      await loadClanBoardComments(clanBoardCurrentPostId, 1);
      await refreshClanPostCommentCount();
    } catch (err) {
      if (clanCommentError) { clanCommentError.textContent = err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.'; clanCommentError.hidden = false; }
    } finally {
      if (clanCommentSubmit) clanCommentSubmit.disabled = false;
    }
  });

  async function refreshClanPostCommentCount() {
    if (!clanBoardCurrentPostId || !clanCommentCount) return;
    try {
      const res = await fetch(`/api/clan-board/posts/${encodeURIComponent(clanBoardCurrentPostId)}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.post) {
        clanCommentCount.textContent = String(data.post.comment_count);
      }
    } catch (_) { /* ignore */ }
  }

  clanWriteBossImageInput?.addEventListener('change', () => {
    const input = clanWriteBossImageInput;
    const file = input?.files?.[0];
    if (!file) return;

    const cell = input._bossTargetCell;
    const btn = cell?.querySelector('.clan-tactic-table__boss-btn');
    if (!cell || !btn) return;

    const dataUrl = (() => {
      const r = new FileReader();
      return new Promise((resolve, reject) => {
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
    })();

    if (input) input.value = '';

    (async () => {
      try {
        const src = await dataUrl;
        const tempImg = new Image();
        await new Promise((resolve) => {
          tempImg.onload = resolve;
          tempImg.onerror = resolve;
          tempImg.src = src;
        });

        const CANVAS_SIZE = 200;
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        const ctx = canvas.getContext('2d');

        if (tempImg.naturalWidth > 0 && tempImg.naturalHeight > 0) {
          ctx.drawImage(tempImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }

        const squaredDataUrl = canvas.toDataURL('image/png');

        btn.remove();

        const wrap = document.createElement('div');
        wrap.className = 'clan-tactic-table__boss-wrap';

        const img = document.createElement('img');
        img.src = squaredDataUrl;
        img.alt = '\uBCF4\uC2A4';
        img.className = 'clan-tactic-table__boss-img';
        img.width = TACTIC_IMAGE_SIZE;
        img.height = TACTIC_IMAGE_SIZE;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'clan-tactic-table__boss-del';
        delBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          wrap.remove();
          cell.appendChild(createBossImageButton(cell));
        });

        wrap.appendChild(img);
        wrap.appendChild(delBtn);
        cell.appendChild(wrap);

        delete input._bossTargetCell;
      } catch (err) {
        btn.remove();
        cell.appendChild(createBossImageButton(cell));
      }
    })();
  });

  function createBossImageButton(cell) {
    const bossBtn = document.createElement('button');
    bossBtn.type = 'button';
    bossBtn.className = 'clan-tactic-table__boss-btn';
    bossBtn.innerHTML = '<span class="clan-tactic-table__slot-label">\uBCF4\uC2A4 \uC774\uBBF8\uC9C0</span>';
    bossBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById('clan-write-boss-image-input');
      if (input) {
        input._bossTargetCell = cell;
        input.click();
      }
    });
    return bossBtn;
  }

  function openTacticCharPopup(cell) {
    if (!tacticCharPopup || !tacticCharPopupGrid) return;
    if (cell.querySelector('.clan-tactic-table__boss-wrap')) return;
    tacticCharTargetCell = cell;
    tacticCharSelectedId = null;
    tacticCharPopup.hidden = false;
    if (tacticCharPopupSearch) tacticCharPopupSearch.value = '';
    if (tacticCharPopupEmpty) tacticCharPopupEmpty.hidden = true;
    ensureCharactersLoaded().then((list) => {
      renderTacticCharPicker(list);
      filterTacticCharPicker();
      tacticCharPopupSearch?.focus();
    });
  }

  function closeTacticCharPopup() {
    if (tacticCharPopup) tacticCharPopup.hidden = true;
    tacticCharTargetCell = null;
    tacticCharSelectedId = null;
  }

  function renderTacticCharPicker(list) {
    if (!tacticCharPopupGrid) return;
    tacticCharPopupGrid.innerHTML = '';
    list.forEach((c) => {
      const id = String(c.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'character-picker-btn tactic-char-picker-btn';
      btn.dataset.characterId = id;
      btn.setAttribute('role', 'listitem');

      const thumb = document.createElement('div');
      thumb.className = 'character-thumb';
      const img = document.createElement('img');
      bindCharacterImage(img, c, { eager: true });

      const nameEl = document.createElement('div');
      nameEl.className = 'character-name';
      nameEl.textContent = c.name || '';

      thumb.appendChild(img);
      btn.appendChild(thumb);
      btn.appendChild(nameEl);

      btn.addEventListener('click', () => {
        tacticCharSelectedId = id;
        const allBtns = tacticCharPopupGrid.querySelectorAll('.tactic-char-picker-btn');
        allBtns.forEach((b) => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
      });

      tacticCharPopupGrid.appendChild(btn);
    });
  }

  function filterTacticCharPicker() {
    const q = (tacticCharPopupSearch?.value || '').trim().toLowerCase();
    const buttons = tacticCharPopupGrid?.querySelectorAll('.tactic-char-picker-btn');
    if (!buttons) return;
    let visibleCount = 0;
    buttons.forEach((btn) => {
      const id = btn.dataset.characterId || '';
      const name = (btn.querySelector('.character-name')?.textContent || '').toLowerCase();
      if (!q || id.includes(q) || name.includes(q)) {
        btn.classList.remove('character-picker-btn--filtered-out');
        visibleCount += 1;
      } else {
        btn.classList.add('character-picker-btn--filtered-out');
      }
    });
    if (tacticCharPopupEmpty) {
      tacticCharPopupEmpty.hidden = !q || visibleCount > 0;
    }
  }

  tacticCharPopupSearch?.addEventListener('input', filterTacticCharPicker);
  tacticCharPopupSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      filterTacticCharPicker();
    }
  });
  tacticCharPopupSearchBtn?.addEventListener('click', filterTacticCharPicker);

  tacticCharPopupConfirm?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selectedId = tacticCharSelectedId;
    const cell = tacticCharTargetCell;
    if (!cell || !selectedId) {
      closeTacticCharPopup();
      return;
    }
    ensureCharactersLoaded().then((list) => {
      const c = list.find((x) => String(x.id) === selectedId);
      if (!c) { closeTacticCharPopup(); return; }
      const btn = cell.querySelector('.clan-tactic-table__char-btn');
      if (btn) btn.remove();

      const wrap = document.createElement('div');
      wrap.className = 'clan-tactic-table__boss-wrap';

      const img = document.createElement('img');
      bindCharacterImage(img, c, { eager: true });
      img.className = 'clan-tactic-table__boss-img';
      img.width = TACTIC_IMAGE_SIZE;
      img.height = TACTIC_IMAGE_SIZE;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'clan-tactic-table__boss-del';
      delBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      delBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        wrap.remove();
        hideTacticCharSlotExtras(cell);
        // Clear character name
        const slot = cell.dataset.tacticSlot;
        const table = cell.closest('.clan-tactic-table');
        if (table && slot) {
          const nameCell = table.querySelector(`.clan-tactic-table__char-name-cell[data-tactic-slot="${slot}"]`);
          if (nameCell) {
            const nameSpan = nameCell.querySelector('.clan-tactic-table__char-name-text');
            if (nameSpan) nameSpan.textContent = '';
          }
        }
        const newBtn = createCharImageButton(cell);
        if (newBtn) cell.appendChild(newBtn);
      });

      wrap.appendChild(img);
      wrap.appendChild(delBtn);
      cell.appendChild(wrap);

      // Auto-fill character name
      const slot = cell.dataset.tacticSlot;
      const table = cell.closest('.clan-tactic-table');
      if (table && slot) {
        const nameCell = table.querySelector(`.clan-tactic-table__char-name-cell[data-tactic-slot="${slot}"]`);
        if (nameCell) {
          const nameSpan = nameCell.querySelector('.clan-tactic-table__char-name-text');
          if (nameSpan) nameSpan.textContent = c.name || '';
        }
      }

      showTacticCharSlotExtras(cell);
      closeTacticCharPopup();
    }).catch(() => {
      closeTacticCharPopup();
    });
  });

  function createCharImageButton(cell) {
    if (cell.querySelector('.clan-tactic-table__boss-wrap')) return null;
    const charBtn = document.createElement('button');
    charBtn.type = 'button';
    charBtn.className = 'clan-tactic-table__char-btn';
    charBtn.innerHTML = '<span class="clan-tactic-table__slot-label">\uCE90\uB9AD\uD130 \uCD94\uAC00</span>';
    charBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTacticCharPopup(cell);
    });
    return charBtn;
  }

  tacticCharPopupCancel?.addEventListener('click', () => { closeTacticCharPopup(); });
  tacticCharPopup?.querySelector('[data-close-tactic-char]')?.addEventListener('click', () => { closeTacticCharPopup(); });

})();
