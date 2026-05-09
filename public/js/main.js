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

  let signupStep = 1;
  let charactersCache = null;
  let selectedCharacterIds = new Set();
  let charactersLoadPromise = null;

  function setSignupStep(step) {
    signupStep = step;
    const is1 = step === 1;
    if (stepAccount) stepAccount.hidden = !is1;
    if (stepCharacters) stepCharacters.hidden = is1;
    if (headAccount) headAccount.hidden = !is1;
    if (headCharacters) headCharacters.hidden = is1;
    if (footerAccount) footerAccount.hidden = !is1;
    if (footerCharacters) footerCharacters.hidden = is1;
    if (modal) {
      const label = is1 ? 'signup-heading' : 'signup-heading-characters';
      modal.setAttribute('aria-labelledby', label);
    }
  }

  function resetSignupFlow() {
    setSignupStep(1);
    selectedCharacterIds = new Set();
    if (deferCheckbox) deferCheckbox.checked = false;
    if (characterLoadError) {
      characterLoadError.hidden = true;
      characterLoadError.textContent = '';
    }
  }

  function openModal() {
    if (!modal) return;
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

  openSignup?.addEventListener('click', openModal);
  closeBackdropEls?.forEach((el) => el.addEventListener('click', closeModal));

  modalBack?.addEventListener('click', () => {
    if (!modal) return;
    if (signupStep === 2) {
      setSignupStep(1);
      modalBack?.focus();
      return;
    }
    closeModal();
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
  });

  profileTrigger?.addEventListener('click', () => profileFile?.click());

  let profilePreviewUrl = null;
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

  const nicknameInput = document.getElementById('nickname');
  const useridInput = document.getElementById('userid');
  const passwordInput = document.getElementById('password');
  const password2Input = document.getElementById('password2');
  const captchaInput = document.getElementById('captcha-input');
  const EXPECTED_CAPTCHA = 'A8K4';
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

  document.getElementById('check-userid')?.addEventListener('click', async () => {
    const username = useridInput?.value.trim();
    if (!username) {
      window.alert('아이디를 입력한 뒤 중복 확인을 눌러 주세요.');
      return;
    }
    try {
      const data = await apiJson(`/api/users/check?${new URLSearchParams({ username })}`);
      window.alert(data.usernameAvailable ? '사용 가능한 아이디입니다.' : '이미 사용 중인 아이디입니다.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  });

  document.getElementById('check-nickname')?.addEventListener('click', async () => {
    const nickname = nicknameInput?.value.trim();
    if (!nickname) {
      window.alert('닉네임을 입력한 뒤 중복 확인을 눌러 주세요.');
      return;
    }
    try {
      const data = await apiJson(`/api/users/check?${new URLSearchParams({ nickname })}`);
      window.alert(data.nicknameAvailable ? '사용 가능한 닉네임입니다.' : '이미 사용 중인 닉네임입니다.');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
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
    const captcha = captchaInput?.value.trim() || '';

    if (captcha.toUpperCase() !== EXPECTED_CAPTCHA) {
      window.alert('보안 문자가 일치하지 않습니다.');
      return;
    }
    if (password !== password2) {
      window.alert('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (!username || !nickname || !password) {
      window.alert('아이디, 닉네임, 비밀번호를 입력해 주세요.');
      return;
    }

    signupNext.disabled = true;
    try {
      const list = await ensureCharactersLoaded();
      setSignupStep(2);
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
    const captcha = captchaInput?.value.trim() || '';
    const defer = Boolean(deferCheckbox?.checked);

    if (captcha.toUpperCase() !== EXPECTED_CAPTCHA) {
      window.alert('보안 문자가 일치하지 않습니다.');
      setSignupStep(1);
      return;
    }
    if (password !== password2) {
      window.alert('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      setSignupStep(1);
      return;
    }

    if (!defer && selectedCharacterIds.size === 0) {
      window.alert('보유 캐릭터를 선택하거나,\n‘보유 캐릭터 추후 등록’에 체크해 주세요.');
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
        }),
      });
      const count = typeof data.ownedCharacterCount === 'number' ? data.ownedCharacterCount : 0;
      const deferMsg = data.deferOwnedCharacters ? '(보유 캐릭터는 추후 등록 예정입니다.)' : `선택한 캐릭터 ${count}명이 저장되었습니다.`;
      window.alert(`회원가입이 완료되었습니다.\n닉네임: ${data.user.nickname}\n아이디: ${data.user.username}\n${deferMsg}`);
      closeModal();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      signupSubmit.disabled = false;
    }
  });

  document.querySelector('.btn-login')?.addEventListener('click', () => {
    window.alert('로그인은 다음 단계에서 구현할 수 있습니다.');
  });
})();
