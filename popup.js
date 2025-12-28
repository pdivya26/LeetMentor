let problemTitle = "";
let lastGeneratedCode = "";
let lastUsedLanguage = "";
const outputText = document.getElementById("output-text");
const spinner = document.getElementById("spinner");
const titleEl = document.getElementById("problem-title");

async function detectLeetCodeLanguage() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          func: () => {
            // Scan all buttons to find one matching known language names
            const languageNames = [
              "C++", "Java", "Python", "Python3", "JavaScript",
              "C", "C#", "Go", "Kotlin", "Rust", "Ruby", "Swift", "TypeScript"
            ];

            const buttons = [...document.querySelectorAll("button")];
            for (const btn of buttons) {
              const text = btn.innerText.trim();
              if (languageNames.includes(text)) {
                return text;
              }
            }
            return null;
          },
        },
        (results) => {
          const lang = results?.[0]?.result;
          if (!lang) {
            resolve(null);
            return;
          }

          // Normalize to Gemini-friendly language names
          const langMap = {
            "C++": "C++",
            "Java": "Java",
            "Python3": "Python",
            "Python": "Python",
            "JavaScript": "JavaScript",
            "C": "C",
            "C#": "C#",
            "Go": "Go",
            "Kotlin": "Kotlin",
            "Rust": "Rust",
            "Ruby": "Ruby",
            "Swift": "Swift",
            "TypeScript": "TypeScript"
          };

          const detected = langMap[lang] || lang;
          resolve(detected);
        }
      );
    });
  });
}

// 1. Get LeetCode problem title using GraphQL
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: () => {
        const slug = window.location.pathname.split("/problems/")[1]?.split("/")[0];
        return slug || null;
      },
    },
    async (results) => {
      const slug = results?.[0]?.result;
      if (!slug) {
        titleEl.innerText = "Not on a LeetCode problem page.";
        return;
      }

      const query = {
        query: `
          query getQuestionTitle($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionFrontendId
              title
            }
          }
        `,
        variables: { titleSlug: slug },
      };

      try {
        const res = await fetch("https://leetcode.com/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
          body: JSON.stringify(query),
        });

        const data = await res.json();

        if (data?.data?.question) {
          const q = data.data.question;
          problemTitle = `${q.questionFrontendId}. ${q.title}`;
          titleEl.innerText = problemTitle;
        } else {
          titleEl.innerText = "Problem not found. Are you logged in?";
          console.error("GraphQL response:", data);
        }
      } catch (err) {
        titleEl.innerText = "Failed to fetch problem title.";
        console.error(err);
      }
    }
  );
});

// 2. Show/Hide Spinner
function showSpinner() {
  spinner.style.display = "block";
  outputText.innerHTML = "";
}

function hideSpinner() {
  spinner.style.display = "none";
}

// 3. Ask Gemini with prompt
async function fetchAIResponse(task, language = "Python", template = "") {
  if (!problemTitle) return "Problem title not found.";

  let prompt = "";
  if (task === "explain") {
    prompt = `Explain the high-level approach to solving the LeetCode problem: "${problemTitle}" without using any code.`;
  } else if (task === "steps") {
    prompt = `Give a detailed step-by-step explanation for solving the LeetCode problem titled "${problemTitle}", without including any code.`;
  } else if (task === "code") {
      if (template && template.trim()) {
        prompt = `You are an expert competitive programmer. Complete the following function exactly with a clean, correct and MOST OPTIMAL solution for the LeetCode problem titled "${problemTitle}". Before writing the code, silently determine the optimal algorithm. Choose the optimal one. If multiple approaches exist, silently choose the one with the best time complexity. It must pass all LeetCode test cases. Do not change its name or parameters:${template}. Write the function body only. Use ${language} strictly (do NOT use any other language). Do not include imports or explanations.`;
      } else {
        prompt = `You are an expert competitive programmer. Write a clean, correct and MOST OPTIMAL solution for the LeetCode problem titled "${problemTitle}". Before writing the code, silently determine the optimal algorithm. Choose the optimal one. If multiple approaches exist, silently choose the one with the best time complexity. It must pass all LeetCode test cases. Strictly use the ${language} programming language only. Do not output any code in other languages. Write only the function for the problem. Avoid any explanations. DO NOT GIVE ANY IMPORTS, give only the function`.trim();
    }
  }

  console.log(prompt);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq error:", err);
      return "Groq API error.";
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "No response from Groq.";
  } catch (e) {
    console.error(e);
    return "Failed to connect to Groq.";
  }
}

function formatResponse(text) {
  try {
    if (!text) return "<div class='rich-answer'>No content</div>";

    // Trim blank lines
    text = String(text).trim().replace(/^\s*\n+|\n+\s*$/g, "");

    // small helper: escape HTML
    const escapeHtml = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    // --- 1) Detect fenced code block ```
    const fenced = text.match(/```([A-Za-z0-9+#]*)?\s*?\n([\s\S]*?)```/m);
    if (fenced) {
      const lang = fenced[1] || lastUsedLanguage || "plaintext";
      const code = escapeHtml(fenced[2].trim());
      return `
        <div class="code-block-wrapper" data-type="code" style="margin-bottom:16px;">
          <div class="code-block" style="border-radius:8px;overflow:hidden;">
            <pre style="margin:0;padding:10px;"><code class="language-${lang}">${code}</code></pre>
          </div>
          <div class="code-actions" style="display:flex;gap:8px;margin-top:8px;">
            <button class="analyze-btn" data-action="analyze">Analyze Complexity</button>
            <button class="copy-btn" data-action="copy">Copy</button>
          </div>
          <div class="code-analysis-result" style="margin-top:8px;"></div>
        </div>
      `;
    }

    // --- 2) If looks like code (no fences) -> show in code block
    const likelyCode = (
      /^(\s*(?:public|class|def|function|#include|import|const|let|var)\b)/m.test(text) ||
      /\n\s*[A-Za-z0-9_]+\s*\([^)]*\)\s*{/.test(text)
    ) && !/^\s*\d+\./m.test(text);

    if (likelyCode) {
      const lang = lastUsedLanguage || "plaintext";
      const code = escapeHtml(text);
      return `
        <div class="code-block-wrapper" data-type="code" style="margin-bottom:16px;">
          <div class="code-block" style="border-radius:8px;overflow:hidden;">
            <pre style="margin:0;"><code class="language-${lang}">${code}</code></pre>
          </div>
          <div class="code-actions" style="display:flex;gap:8px;margin-top:8px;">
            <button class="analyze-btn" data-action="analyze">Analyze Complexity</button>
            <button class="copy-btn" data-action="copy">Copy</button>
          </div>
          <div class="code-analysis-result"></div>
        </div>
      `;
    }

    // --- 3) Explanation text formatting (no code actions here) ---
    let html = text;

    // Escape HTML but allow <sup> and <sub>
    html = html.replace(/<(?!\/?(sup|sub)\b)[^>]*>/g, (match) => escapeHtml(match));

    // Headings
    html = html
      .replace(/^###\s*(.*)$/gm, "<h4 style='margin:10px 0 6px;color:#f0f0f0;'>$1</h4>")
      .replace(/^##\s*(.*)$/gm, "<h3 style='margin:12px 0 6px;color:#f0f0f0;'>$1</h3>")
      .replace(/^#\s*(.*)$/gm, "<h2 style='margin:14px 0 8px;color:#f0f0f0;'>$1</h2>");

    // Bold / Italic / Inline code
    html = html
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code style='background:#262626;padding:2px 4px;border-radius:4px;'>$1</code>");

    // Convert bullet lists (* or -)
    html = html.replace(/(\n|^)[*-]\s+(.*?)(?=\n[*-]\s+|\n\d+\.|$)/gs, (match) => {
      const items = match
        .trim()
        .split(/\n[*-]\s+/)
        .map((i) => `<li>${i.replace(/^[*-]\s*/, "")}</li>`)
        .join("");
      return `<ul style='margin:8px 0 8px 20px;'>${items}</ul>`;
    });

    // Numbered lists (more flexible)
    html = html.replace(/(^|\n)\s*\d+[\.\)\:\-]\s+([^\n]+)/g, (m) => {
      // Build a small normalized block first
      const items = m
        .trim()
        .split(/\n\s*\d+[\.\)\:\-]\s+/)
        .map(i => `<li>${i.replace(/^\d+[\.\)\:\-]\s*/, "")}</li>`)
        .join("");
      return `<ol style='margin:8px 0 8px 20px;'>${items}</ol>`;
    });

    // Paragraph and line breaks
    html = html
      .replace(/\n{2,}/g, "<br><br>")
      .replace(/\n/g, "<br>");

    // Final wrapper (no code actions)
    return `
      <div class="rich-answer"
           style="line-height:1.7;
                  font-size:14px;
                  padding:12px;
                  border-radius:8px;
                  color:#e2e2e2;
                  overflow-y:auto;
                  scrollbar-width:none;">
        ${html}
      </div>
    `;
  } catch (err) {
    console.error("formatResponse error:", err);
    return `<div class='rich-answer'>Formatting error: ${String(err)}</div>`;
  }
}

function hideLanguageSelector() {
  document.getElementById("language-container").style.display = "none";
}

// 5. Button handlers
// Explain Button
document.getElementById("explain-btn").addEventListener("click", async () => {
  outputText.innerHTML = ""; // clear old output
  outputText.style.display = "block"; 
  hideLanguageSelector(); // hide language dropdown
  showSpinner();
  const result = await fetchAIResponse("explain");
  hideSpinner();
  outputText.innerHTML = formatResponse(result);
});

// Steps Button
document.getElementById("steps-btn").addEventListener("click", async () => {
  outputText.innerHTML = "";
  outputText.style.display = "block"; 
  hideLanguageSelector(); // hide language dropdown
  showSpinner();
  const result = await fetchAIResponse("steps");
  hideSpinner();
  outputText.innerHTML = formatResponse(result);
});

// Code Button
document.getElementById("code-btn").addEventListener("click", async () => {
  const dropdown = document.getElementById("language");
  document.getElementById("language-container").style.display = "block"; // Show dropdown
  outputText.innerHTML = ""; // clear old output
  // Detect language when dropdown is shown
  const detectedLang = await detectLeetCodeLanguage();

  if (detectedLang) {
    const match = [...dropdown.options].find(opt => opt.value === detectedLang);
    if (match) {
      dropdown.value = detectedLang;
    }
  }
});

// Get current template from editor
async function getEditorTemplate() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const container = document.querySelector(".view-lines");
      if (!container) return "";
      return [...container.querySelectorAll("div")].map(d => d.innerText).join("\n");
    }
  });

  console.log("Editor template fetched:", result[0]?.result);
  return result?.[0]?.result || "";
}

// Generate Code Button
document.getElementById("generate-code-btn").addEventListener("click", async () => {
  const language = await detectLeetCodeLanguage() || document.getElementById("language").value;
  lastUsedLanguage = language;
  outputText.innerHTML = ""; // clear previous output before spinner
  outputText.style.display = "block"; 
  outputText.innerText = `Generating ${language} solution...`;
  showSpinner();
  const template = await getEditorTemplate(); // Fetch template from editor
  const result = await fetchAIResponse("code", language, template);
  hideSpinner();
  lastGeneratedCode = result;
  outputText.style.display = "block";
  outputText.innerHTML = formatResponse(result);
  hljs.highlightAll();
});

// Use event delegation so it works even for dynamically inserted buttons
outputText.addEventListener("click", async (e) => {
  const button = e.target;
  if (!button.matches(".copy-btn, .analyze-btn")) return;

  const wrapper = button.closest(".code-block-wrapper");
  const codeElement = wrapper?.querySelector("code");
  const codeToAnalyze = codeElement?.innerText || lastGeneratedCode || "";
  const box = wrapper?.querySelector(".code-analysis-result");

  if (!box) return;

  // COPY HANDLER
  if (button.dataset.action === "copy") {
    try {
      await navigator.clipboard.writeText(codeToAnalyze);
      // Remove previous message
      const existing = wrapper.querySelector(".copy-msg");
      if (existing) existing.remove();

      // Show "Copied!" message
      const msg = document.createElement("div");
      msg.className = "copy-msg";
      msg.textContent = "Copied!";
      msg.style.color = "white";
      msg.style.fontSize = "12px";
      msg.style.textAlign = "center";
      msg.style.marginTop = "6px";
      wrapper.querySelector(".code-actions").after(msg);

      setTimeout(() => msg.remove(), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
    return;
  }

  // ANALYZE HANDLER
  if (button.dataset.action === "analyze") {
    if (box.dataset.loading === "true") return; // prevent duplicate
    box.dataset.loading = "true";

    if (!codeToAnalyze.trim()) {
      box.innerHTML = "<p>No code available to analyze.</p>";
      box.dataset.loading = "false";
      return;
    }

    // Show spinner
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;color:#999;font-style:italic;margin-top:12px;">
        <svg width="18" height="18" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" stroke="#e8961c">
          <g fill="none" fill-rule="evenodd">
            <g transform="translate(2 2)" stroke-width="3">
              <circle stroke-opacity=".2" cx="18" cy="18" r="18"/>
              <path d="M36 18c0-9.94-8.06-18-18-18">
                <animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur="1s" repeatCount="indefinite"/>
              </path>
            </g>
          </g>
        </svg>
        <span>Analyzing complexity...</span>
      </div>
    `;

    // Ensure language fallback
    const lang = lastUsedLanguage || "Python";

    // Build prompt
    const prompt = `
      You are a competitive programming assistant.
      Analyze ONLY the time and space complexities (Big-O) of the following ${lang} code.
      Do NOT rewrite or explain the code.
      Output strictly like this:

      Time Complexity: O(...)
      Space Complexity: O(...)

      Code:
      ${codeToAnalyze}
    `.trim();

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "user", content: prompt }
            ],
            temperature: 0
          })
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error("Groq API error:", errText);
        throw new Error("Groq request failed");
      }

      const data = await res.json();

      let text = data?.choices?.[0]?.message?.content || "No response.";

      // Format as a dedicated complexity block
      box.innerHTML = `
        <div style="background:#1e1e1e;padding:12px;border-radius:6px;margin-top:20px;">
          <h4 style="color:#ffffff;margin-bottom:8px;text-align:center">Complexity Analysis</h4>
          <pre style="margin:0;font-family:monospace;">${text}</pre>
        </div>
      `;
    } catch (err) {
      console.error(err);
      box.innerHTML = "<p>Failed to analyze complexity.</p>";
    } finally {
      box.dataset.loading = "false";
    }
  }
});
