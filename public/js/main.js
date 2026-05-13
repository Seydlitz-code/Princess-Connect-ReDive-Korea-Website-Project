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

    const activeBtn = links.find((b) => b.dataset.board === boardId);
    requestAnimationFrame(() => moveUnderline(activeBtn));
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
  let profilePreviewUrl = null;

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
    if (!signupNext) return;
    if (signupStep !== 1) return;
    const u = useridInput?.value.trim() || '';
    const n = nicknameInput?.value.trim() || '';
    const pw = passwordInput?.value || '';
    const pw2 = password2Input?.value || '';
    const idOk = u.length > 0 && usernameApprovedFor === u;
    const nickOk = n.length > 0 && nicknameApprovedFor === n;
    const pwOk = pw.length >= PASSWORD_LEN_MIN && pw === pw2;
    signupNext.disabled = !(idOk && nickOk && pwOk);
  }

  function resetSignupFlow() {
    selectedCharacterIds = new Set();
    nicknameApprovedFor = null;
    usernameApprovedFor = null;
    signupStepPassToken = '';
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
    resetSignupFlow();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    signupNext?.focus();
  }

  function closeModal() {
    if (!modal) return;
    resetSignupFlow();
    modal.hidden = true;
    document.body.style.overflow = '';
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
    loginModal.hidden = false;
    document.body.style.overflow = 'hidden';
    loginUsernameEl?.focus();
  }

  function closeLoginModal() {
    if (!loginModal) return;
    loginModal.hidden = true;
    if (signupModalShows()) return;
    document.body.style.overflow = '';
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
      document.body.style.overflow = signupModalShows() ? 'hidden' : '';
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
    if (loginModal && !loginModal.hidden) {
      closeLoginModal();
      document.body.style.overflow = signupModalShows() ? 'hidden' : '';
      return;
    }
    if (modal && !modal.hidden) closeModal();
  });

  profileTrigger?.addEventListener('click', () => profileFile?.click());

  profileFile?.addEventListener('change', () => {
    const file = profileFile.files?.[0];
    if (!file || !profilePreview) return;
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = URL.createObjectURL(file);
    const prevImg = profilePreview.querySelector('img');
    if (prevImg) {
      prevImg.src = profilePreviewUrl;
    } else {
      profilePreview.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '프로필 미리보기';
      img.src = profilePreviewUrl;
      profilePreview.appendChild(img);
    }
  });


  const MAX_PROFILE_BYTES = 512 * 1024;

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
    const v = nicknameInput.value.trim();
    if (nicknameApprovedFor !== null && v !== nicknameApprovedFor) nicknameApprovedFor = null;
    clearCheckFeedback(nicknameFeedbackEl);
    syncSignupNextButton();
  });

  useridInput?.addEventListener('input', () => {
    const v = useridInput.value.trim();
    if (usernameApprovedFor !== null && v !== usernameApprovedFor) usernameApprovedFor = null;
    clearCheckFeedback(useridFeedbackEl);
    syncSignupNextButton();
  });

  checkNicknameBtn?.addEventListener('click', async () => {
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

  passwordInput?.addEventListener('input', syncSignupNextButton);
  password2Input?.addEventListener('input', syncSignupNextButton);

  signupCaptchaRefresh?.addEventListener('click', () => {
    void loadSignupCaptcha();
  });

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
      reader.readAsDataURL(file);
    });
  }

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

  function renderCharacterGrid(list) {
    if (!characterGrid) return;
    characterGrid.innerHTML = '';
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
        btn.classList.toggle('is-selected', selectedCharacterIds.has(id));
      };
      sync();

      btn.addEventListener('click', () => {
        if (selectedCharacterIds.has(id)) selectedCharacterIds.delete(id);
        else selectedCharacterIds.add(id);
        sync();
      });

      characterGrid.appendChild(btn);
    });
  }

  signupNext?.addEventListener('click', async () => {
    const nickname = nicknameInput?.value.trim() || '';
    const username = useridInput?.value.trim() || '';
    const password = passwordInput?.value || '';
    const password2 = password2Input?.value || '';
    const captchaAnswer = signupCaptchaAnswer?.value || '';

    if (!username || !nickname) {
      return;
    }
    if (usernameApprovedFor !== username || nicknameApprovedFor !== nickname) {
      return;
    }

    if (password.length < PASSWORD_LEN_MIN) {
      window.alert(`비밀번호는 ${PASSWORD_LEN_MIN}자 이상으로 입력해 주세요.`);
      return;
    }
    if (password !== password2) {
      window.alert('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    if (!signupCaptchaId) {
      window.alert('보안 문자를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
      void loadSignupCaptcha();
      return;
    }

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
        window.alert(captchaData.error || '보안 문자 확인에 실패했습니다.');
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

    let profileImage = null;
    const file = profileFile?.files?.[0];
    if (file) {
      if (file.size > MAX_PROFILE_BYTES) {
        window.alert('프로필 이미지는 약 512KB 이하로 올려 주세요.');
        return;
      }
      try {
        profileImage = await fileToDataUrl(file);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
        return;
      }
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
