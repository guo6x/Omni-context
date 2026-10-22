'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

interface RetainedPanelProps {
  visible: boolean;
  children: ReactNode;
  name: string;
  modal?: boolean;
}

/** 首次打开才挂载；隐藏不销毁进行中的任务、回执或重复提交保护。 */
export default function RetainedPanel({ visible, children, name, modal = false }: RetainedPanelProps) {
  const [hasOpened, setHasOpened] = useState(visible);
  const inertSiblingsRef = useRef(new Map<HTMLElement, boolean>());

  useEffect(() => {
    if (visible) setHasOpened(true);
  }, [visible]);

  // React 18 的 JSX 类型尚未声明 inert；通过 DOM 属性在提交阶段设置。
  // hidden 同时保证 SSR 与首次客户端渲染不暴露隐藏内容。
  const restoreModalBackground = useCallback(() => {
    for (const [element, wasInert] of inertSiblingsRef.current) {
      if (element.isConnected) element.inert = wasInert;
    }
    inertSiblingsRef.current.clear();
  }, []);

  const setContainer = useCallback((container: HTMLDivElement | null) => {
    if (!container) {
      restoreModalBackground();
      return;
    }
    container.inert = !visible;
    if (!visible && container.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }

    if (visible && modal) {
      // Make the rest of the app inert while this dialog is open, including
      // siblings of the main panel such as the app header.
      let current: HTMLElement = container;
      while (current.parentElement && current.parentElement !== document.body) {
        const parent = current.parentElement;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === current || !(sibling instanceof HTMLElement)) continue;
          if (!inertSiblingsRef.current.has(sibling)) {
            inertSiblingsRef.current.set(sibling, sibling.inert);
          }
          sibling.inert = true;
        }
        current = parent;
      }
    } else {
      restoreModalBackground();
    }
  }, [modal, restoreModalBackground, visible]);

  const blockHiddenInteraction = (event: SyntheticEvent) => {
    if (visible) return;
    event.preventDefault();
    event.stopPropagation();
  };

  if (!visible && !hasOpened) return null;

  return (
    <div
      ref={setContainer}
      hidden={!visible}
      aria-hidden={!visible}
      data-retained-panel={name}
      onClickCapture={blockHiddenInteraction}
      onKeyDownCapture={blockHiddenInteraction}
      onInputCapture={blockHiddenInteraction}
      onChangeCapture={blockHiddenInteraction}
      onDragEnterCapture={blockHiddenInteraction}
      onDragOverCapture={blockHiddenInteraction}
      onDropCapture={blockHiddenInteraction}
    >
      {children}
    </div>
  );
}
