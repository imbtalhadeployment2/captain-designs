// CAPTAIN DESIGNS — small UI helpers
document.addEventListener('DOMContentLoaded', () => {
  const chat = document.getElementById('chatBox');
  if (chat) chat.scrollTop = chat.scrollHeight;
  // auto-dismiss flash messages after 6s
  const flash = document.querySelector('.flash');
  if (flash) setTimeout(() => { flash.style.transition = 'opacity .5s'; flash.style.opacity = '0'; }, 6000);
});
