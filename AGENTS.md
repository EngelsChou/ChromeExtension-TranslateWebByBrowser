# Permanent repository rules

- Before every commit, run the project build, lint, and test commands successfully.
- After successful verification, commit the scoped changes and push the current branch to GitHub directly.
- Keep both `README.md` (Traditional Chinese) and `README.en.md` (English) current whenever behavior, setup, architecture, limitations, or security guidance changes.
- Generate a Chrome Extension release ZIP after every releasable change and keep it in `dist/release/`.
- Never silently stage or overwrite unrelated user changes.
- Keep the shipped product self-contained in the Chrome Extension. Do not require a local bridge, native host, executable, Node.js, npm, or command-line startup for normal use.
- Do not add OpenAI API, Claude, Gemini, or any provider other than the approved authenticated ChatGPT and Microsoft 365 Copilot web connection modes without explicit user approval.
- For live browser verification, always use the user's left/home Chrome profile for ChatGPT and the user's right/company Chrome profile for Microsoft 365 Copilot. Never substitute one profile for the other; if the required profile is unavailable, stop that provider's live test and ask the user to open it.
