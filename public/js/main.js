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
  const closeEls = modal?.querySelectorAll('[data-close-modal]');
  const profileFile = document.getElementById('profile-file');
  const profileTrigger = document.getElementById('profile-file-trigger');
  const profilePreview = document.getElementById('profile-preview');

  function openModal() {
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.link-back')?.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    openSignup?.focus();
  }

  openSignup?.addEventListener('click', openModal);
  closeEls?.forEach((el) => el.addEventListener('click', closeModal));

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
  const signupSubmit = document.getElementById('signup-submit');
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

  signupSubmit?.addEventListener('click', async () => {
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
        }),
      });
      window.alert(`회원가입이 완료되었습니다.\n닉네임: ${data.user.nickname}\n아이디: ${data.user.username}`);
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
