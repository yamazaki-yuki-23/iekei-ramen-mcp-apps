const urlInput = document.getElementById("mcp-url");
const copyButton = document.getElementById("copy-url");
const status = document.getElementById("copy-status");

if (urlInput instanceof HTMLInputElement && copyButton && status) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlInput.value);
      status.textContent = "URLをコピーしました。";
    } catch {
      urlInput.focus();
      urlInput.select();
      status.textContent = "コピーできませんでした。選択されたURLを手動でコピーしてください。";
    }
  });
}
