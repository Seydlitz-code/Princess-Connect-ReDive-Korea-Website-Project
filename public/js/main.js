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

  document.getElementById('signup-submit')?.addEventListener('click', () => {
    window.alert('회원가입 처리는 다음 단계에서 서버·데이터베이스와 연동할 수 있습니다.');
  });

  document.querySelector('.btn-login')?.addEventListener('click', () => {
    window.alert('로그인은 다음 단계에서 구현할 수 있습니다.');
  });
})();
