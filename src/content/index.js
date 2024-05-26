import React from "react";
import ReactDOM from "react-dom";
import browser from "webextension-polyfill";
import { initSettings, getSettings, handleSettingsChange } from "src/settings/settings";
import { updateLogLevel, overWriteLogLevel } from "src/common/log";
import TranslateContainer from "./components/TranslateContainer";

const init = async () => {
  await initSettings();
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener('scroll', handleScroll);
  browser.storage.local.onChanged.addListener(handleSettingsChange);
  browser.runtime.onMessage.addListener(handleMessage);
  overWriteLogLevel();
  updateLogLevel();
  disableExtensionByUrlList();
};
init();

let prevSelectedText = "";
const handleMouseUp = async e => {
  await waitTime(10);

  const isLeftClick = e.button === 0;
  if (!isLeftClick) return;

  const isInPasswordField = e.target.tagName === "INPUT" && e.target.type === "password";
  if (isInPasswordField) return;

  const inCodeElement = e.target.tagName === "CODE" || (!!e.target.closest && !!e.target.closest("code"));
  if (inCodeElement && getSettings("isDisabledInCodeElement")) return;

  const isInThisElement =
    document.querySelector("#simple-translate") &&
    document.querySelector("#simple-translate").contains(e.target);
  if (isInThisElement) return;

  removeTranslatecontainer();

  const ignoredDocumentLang = getSettings("ignoredDocumentLang").split(",").map(s => s.trim()).filter(s => !!s);
  if (ignoredDocumentLang.length) {
    const ignoredLangSelector = ignoredDocumentLang.map(lang => `[lang="${lang}"]`).join(',')
    if (!!e.target.closest && !!e.target.closest(ignoredLangSelector)) return;
  }

  const selectedText = getSelectedText(e);
  prevSelectedText = selectedText;
  if (selectedText.length === 0) return;

  if (getSettings("isDisabledInTextFields")) {
    if (isInContentEditable()) return;
  }

  if (getSettings("ifOnlyTranslateWhenModifierKeyPressed")) {
    const modifierKey = getSettings("modifierKey");
    switch (modifierKey) {
      case "shift":
        if (!e.shiftKey) return;
        break;
      case "alt":
        if (!e.altKey) return;
        break;
      case "ctrl":
        if (!e.ctrlKey) return;
        break;
      case "cmd":
        if (!e.metaKey) return;
        break;
      default:
        break;
    }
  }

  const clickedPosition = { x: e.clientX, y: e.clientY };
  const selectedPosition = getSelectedPosition();
  showTranslateContainer(selectedText, selectedPosition, clickedPosition);
};

const waitTime = time => {
  return new Promise(resolve => setTimeout(() => resolve(), time));
};

const handleScroll = () => {
  removeTranslatecontainer();
};


const handleTextSelection = (e) => {
  const getWordBoundaries = (text, offset) => {
    const isBoundary = (char) => {
      if (e.altKey) {
        return /[.,;"“”]/.test(char);
      } else {
        return /[\s.,;"“”]/.test(char);
      }
    }
    let start = offset;
    let end = offset;

    // Finde Wortanfang
    while (start > 0 && !isBoundary(text[start - 1])) {
      start--;
    }

    // Finde Wortende
    while (end < text.length && !isBoundary(text[end])) {
      end++;
    }

    return { start, end };
  };

  const getSurroundingWords = (text, start, end) => {

    const isBoundary = (char) => /[\s.,;"“”]/.test(char);

    // Finde linkes Wort
    let leftStart = start - 1;
    let c_l = text[leftStart];
    if (c_l === ' ') {
      while (leftStart > 0 && !isBoundary(text[leftStart - 1])) {
        leftStart--;
      }
    } else {
      leftStart = start;
    }

    // Finde rechtes Wort
    let rightEnd = end;
    let c_r = text[rightEnd];
    if (c_r === ' ') {
      rightEnd++;
    }
    while (rightEnd < text.length && !isBoundary(text[rightEnd])) {
      rightEnd++;
    }

    // console.log(c_l + ' ... ' + c_r);

    return {
      left: text.slice(leftStart, start).trim(),
      right: text.slice(end, rightEnd).trim()
    };
  };


  let selection = window.getSelection();
  let selectedText = selection.toString();

  if (selectedText.length > 0) {
    return selectedText;
  } else {

    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      let caret = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (caret) {
        range = document.createRange();
        range.setStart(caret.offsetNode, caret.offset);
        range.setEnd(caret.offsetNode, caret.offset);
      }
    }

    if (range) {
      const textNode = range.startContainer;
      const text = textNode.textContent;
      const offset = range.startOffset;

      const wordBoundaries = getWordBoundaries(text, offset);
      const clickedWord = text.slice(wordBoundaries.start, wordBoundaries.end);
      const surroundingWords = getSurroundingWords(text, wordBoundaries.start, wordBoundaries.end);

      const extendedText = `${surroundingWords.left} ${clickedWord} ${surroundingWords.right}`.trim();
      return extendedText;
    }
  }

  return '';
};

const getSelectedText = (e) => {
  const element = document.activeElement;
  const isInTextField = element.tagName === "INPUT" || element.tagName === "TEXTAREA";

  const selectedText = isInTextField
    ? element.value.substring(element.selectionStart, element.selectionEnd)
    : handleTextSelection(e);

  /* const selectedText = isInTextField
    ? element.value.substring(element.selectionStart, element.selectionEnd)
    : window.getSelection()?.toString() ?? "";
  */
  return selectedText;
};

const getSelectedPosition = () => {
  const selection = window.getSelection();
  const element = document.activeElement;
  const isInTextField = element.tagName === "INPUT" || element.tagName === "TEXTAREA";

  let selectedRect;
  if (isInTextField) {
    selectedRect = element.getBoundingClientRect();
  } else if (selection.rangeCount > 0) {
    selectedRect = selection.getRangeAt(0).getBoundingClientRect();
  } else {
    return { x: 0, y: 0 }; // Standardposition, wenn keine Auswahl vorhanden ist
  }

  let selectedPosition;
  const panelReferencePoint = getSettings("panelReferencePoint");
  switch (panelReferencePoint) {
    case "topSelectedText":
      selectedPosition = {
        x: selectedRect.left + selectedRect.width / 2,
        y: selectedRect.top
      };
      break;
    case "bottomSelectedText":
    default:
      selectedPosition = {
        x: selectedRect.left + selectedRect.width / 2,
        y: selectedRect.bottom
      };
      break;
  }
  return selectedPosition;
};


const isInContentEditable = () => {
  const element = document.activeElement;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return true;
  if (element.contentEditable === "true") return true;
  return false;
};

const handleKeyDown = e => {
  if (e.key === "Escape") {
    removeTranslatecontainer();
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    browser.storage.local.onChanged.removeListener(handleSettingsChange);
  } else {
    browser.storage.local.onChanged.addListener(handleSettingsChange);
  }
};

let isEnabled = true;
const handleMessage = async request => {
  const empty = new Promise(resolve => {
    setTimeout(() => {
      return resolve("");
    }, 100);
  });

  switch (request.message) {
    case "getTabUrl":
      if (!isEnabled) return empty;
      if (window == window.parent) return location.href;
      else return empty;
    case "getSelectedText":
      if (!isEnabled) return empty;
      if (prevSelectedText.length === 0) return empty;
      else return prevSelectedText;
    case "translateSelectedText": {
      if (!isEnabled) return empty;
      const selectedText = getSelectedText();
      if (selectedText.length === 0) return;
      const selectedPosition = getSelectedPosition();
      removeTranslatecontainer();
      showTranslateContainer(selectedText, selectedPosition, null, true);
      break;
    }
    case "getEnabled":
      return isEnabled;
    case "enableExtension":
      isEnabled = true;
      break;
    case "disableExtension":
      removeTranslatecontainer();
      isEnabled = false;
      break;
    default:
      return empty;
  }
};

const disableExtensionByUrlList = () => {
  const disableUrls = getSettings("disableUrlList").split("\n");
  let pageUrl;
  try {
    pageUrl = top.location.href;
  } catch (e) {
    pageUrl = document.referrer;
  }

  const matchesPageUrl = urlPattern => {
    const pattern = urlPattern
      .trim()
      .replace(/[-[\]{}()*+?.,\\^$|#\s]/g, match => (match === "*" ? ".*" : "\\" + match));
    if (pattern === "") return false;
    return RegExp("^" + pattern + "$").test(pageUrl);
  };

  const isMatched = disableUrls.some(matchesPageUrl);
  if (isMatched) isEnabled = false;
};

const removeTranslatecontainer = async () => {
  const element = document.getElementById("simple-translate");
  if (!element) return;

  ReactDOM.unmountComponentAtNode(element);
  element.parentNode.removeChild(element);
};

const showTranslateContainer = (
  selectedText,
  selectedPosition,
  clickedPosition = null,
  shouldTranslate = false
) => {
  const element = document.getElementById("simple-translate");
  if (element) return;
  if (!isEnabled) return;

  const themeClass = "simple-translate-" + getSettings("theme") + "-theme";

  document.body.insertAdjacentHTML("beforeend", `<div id="simple-translate" class="${themeClass}"></div>`);
  ReactDOM.render(
    <TranslateContainer
      removeContainer={removeTranslatecontainer}
      selectedText={selectedText}
      selectedPosition={selectedPosition}
      clickedPosition={clickedPosition}
      shouldTranslate={shouldTranslate}
    />,
    document.getElementById("simple-translate")
  );
};
