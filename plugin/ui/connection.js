/**
 * Shared "CI connection" section of the property inspectors.
 *
 * The plugin owns the connections: this page sends the URL and tokens once
 * ({ event: "configure" }) and shows the status the plugin reports back
 * ({ event: "status" }). The tokens are stored in the plugin's global settings.
 */
(function () {
  const client = SDPIComponents.streamDeckClient;
  const $ = (id) => document.getElementById(id);

  const STATE_TEXT = {
    connected: "Connected",
    connecting: "Connecting…",
    error: "Connection problem",
    unconfigured: "Not set up",
  };

  function send(payload) {
    client.send("sendToPlugin", payload);
  }

  function showMessage(text, kind) {
    const box = $("ci-message");
    box.textContent = text || "";
    box.className = `message ${kind || ""}`;
    box.hidden = !text;
  }

  function renderProvider(prefix, status, detail) {
    const badge = $(`${prefix}-status`);
    badge.className = `status ${status.state}`;
    $(`${prefix}-status-text`).textContent = STATE_TEXT[status.state] || status.state;
    $(`${prefix}-status-detail`).textContent = status.error
      ? status.error
      : status.state === "connected"
        ? `${detail ? `${detail} · ` : ""}${status.repoCount} repos`
        : detail;
  }

  /** Fills a field once; user input is never overwritten. */
  function prefill(id, value) {
    const field = $(id);
    if (!field.dataset.filled && value) {
      field.value = value;
    }
    field.dataset.filled = "1";
  }

  function renderStatus(status) {
    renderProvider("ci-wp", status.woodpecker, status.woodpecker.url);
    renderProvider("ci-gh", status.github, "github.com");
    prefill("ci-wp-url", status.woodpecker.url);
    prefill("ci-wp-token", status.woodpecker.token);
    prefill("ci-gh-token", status.github.token);

    for (const el of document.querySelectorAll(".requires-setup")) {
      el.hidden = !status.configured;
    }
  }

  client.sendToPropertyInspector.subscribe((message) => {
    const payload = message.payload || {};
    if (payload.event === "status") {
      renderStatus(payload);
      $("ci-save").disabled = false;
    }
  });

  const TEMPLATE = `
    <sdpi-item label="Woodpecker">
      <div id="ci-wp-status" class="status unconfigured">
        <div><strong id="ci-wp-status-text">…</strong><span id="ci-wp-status-detail"></span></div>
      </div>
    </sdpi-item>
    <sdpi-item label="URL"><sdpi-textfield id="ci-wp-url" placeholder="https://ci.example.com"></sdpi-textfield></sdpi-item>
    <sdpi-item label="Token"><sdpi-password id="ci-wp-token" placeholder="Personal access token"></sdpi-password></sdpi-item>

    <sdpi-item label="GitHub Actions">
      <div id="ci-gh-status" class="status unconfigured">
        <div><strong id="ci-gh-status-text">…</strong><span id="ci-gh-status-detail"></span></div>
      </div>
    </sdpi-item>
    <sdpi-item label="Token"><sdpi-password id="ci-gh-token" placeholder="Fine-grained personal access token"></sdpi-password></sdpi-item>

    <sdpi-item><sdpi-button id="ci-save">Save connection</sdpi-button></sdpi-item>
    <div id="ci-message" class="message" hidden></div>
    <p class="hint">
      Leave a provider empty to disable it. The tokens are stored in the Stream Deck settings on this computer
      and only sent to the Woodpecker server you enter and to api.github.com.
    </p>`;

  window.addEventListener("DOMContentLoaded", () => {
    $("ci-connection").innerHTML = TEMPLATE;

    $("ci-save").addEventListener("click", () => {
      const woodpeckerUrl = ($("ci-wp-url").value || "").trim();
      const woodpeckerToken = ($("ci-wp-token").value || "").trim();
      const githubToken = ($("ci-gh-token").value || "").trim();
      if (woodpeckerUrl && !/^https?:\/\//.test(woodpeckerUrl)) {
        showMessage("The Woodpecker URL must start with http:// or https://", "error");
        return;
      }
      if ((woodpeckerUrl && !woodpeckerToken) || (!woodpeckerUrl && woodpeckerToken)) {
        showMessage("Woodpecker needs both the URL and a token", "error");
        return;
      }
      if (!woodpeckerUrl && !githubToken) {
        showMessage("Enter a Woodpecker URL and token and/or a GitHub token", "error");
        return;
      }
      showMessage("Saved, connecting…", "success");
      $("ci-save").disabled = true;
      send({ event: "configure", settings: { woodpeckerUrl, woodpeckerToken, githubToken } });
    });

    send({ event: "getStatus" });
  });
})();
