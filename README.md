# Vedam LMS Reskin

A Chrome extension that gives the [Vedam School of Technology](https://student.vedam.org) LMS coding lab a sleek **dark theme** — cleaner layout, resizable panels, and better aesthetics.

## ✨ Features

- **Dark theme** — Zinc-scale palette inspired by modern code editors
- **One Dark Pro** syntax highlighting for the Monaco code editor
- **Resizable panels** — drag to resize the description, editor, and test-case panes
- **Decluttered UI** — hides the header and sidebar so the coding lab goes full-screen
- **Toast & result styling** — color-coded success / error feedback
- **Toggle on/off** — a simple switch in the nav bar lets you flip the reskin per page

## 📦 Installation

1. Clone or download this repo  
2. Open `chrome://extensions` in Chrome  
3. Enable **Developer mode** (top-right toggle)  
4. Click **Load unpacked** and select the repo folder  
5. Navigate to any coding lab page on `student.vedam.org` — the reskin activates automatically

## 🗂 Project Structure

```
manifest.json          → Extension manifest (MV3)
content.css            → Dark theme styles
content.js             → DOM tagging, panel resizers, toggle switch
page-monaco-theme.js   → One Dark Pro theme & tokenizer for Monaco
page-cursor-fix.js     → Cursor rendering fix for the editor
page-all-files.js      → File-list enhancements
page-all-problems.js   → Problem-list enhancements
icon48.png / icon128.png → Extension icons
```

## 🖥 Usage

Once installed the extension runs automatically on `*.vedam.org` pages. On any coding lab page you'll see a **Reskin** toggle in the top nav bar — flip it to enable or disable the theme.

Your preference is saved in `localStorage` and persists across sessions.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
