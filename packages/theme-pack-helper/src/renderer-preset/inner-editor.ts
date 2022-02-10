/* Copyright 2021, Milkdown by Mirone. */
import { createThemeSliceKey, Emotion, getPalette, ThemeFont, ThemeManager, ThemeSize } from '@milkdown/core';
import { EditorState, EditorView, keymap, newlineInCode, Node, StepMap, TextSelection } from '@milkdown/prose';

type InnerEditorRenderer = {
    dom: HTMLElement;
    preview: HTMLElement;
    editor: HTMLElement;
    onUpdate: (node: Node, isInit: boolean) => void;
    onFocus: (node: Node) => void;
    onBlur: (node: Node) => void;
    onDestroy: () => void;
    stopEvent: (event: Event) => boolean;
};
type InnerEditorOptions = {
    view: EditorView;
    getPos: () => number;
    render: (content: string) => void;
};
export const ThemeInnerEditor = createThemeSliceKey<InnerEditorRenderer, InnerEditorOptions, 'inner-editor'>(
    'inner-editor',
);
export type ThemeInnerEditorType = typeof ThemeInnerEditor;

const getStyle = (manager: ThemeManager, { css }: Emotion) => {
    const palette = getPalette(manager);
    const radius = manager.get(ThemeSize, 'radius');
    const code = manager.get(ThemeFont, 'code');

    const codeStyle = css`
        color: ${palette('neutral', 0.87)};
        background-color: ${palette('background')};
        border-radius: ${radius};
        padding: 1rem 2rem;
        font-size: 0.875rem;
        font-family: ${code};
        overflow: hidden;
        .ProseMirror {
            outline: none;
        }
    `;

    const hideCodeStyle = css`
        display: none;
    `;

    const previewPanelStyle = css`
        display: flex;
        justify-content: center;
        padding: 1rem 0;
    `;

    return {
        codeStyle,
        hideCodeStyle,
        previewPanelStyle,
    };
};

const createInnerEditor = (outerView: EditorView, getPos: () => number) => {
    let isEditing = false;
    let innerView: EditorView | undefined;

    const openEditor = ($: HTMLElement, doc: Node) => {
        innerView = new EditorView($, {
            state: EditorState.create({
                doc,
                plugins: [
                    keymap({
                        Tab: (state, dispatch) => {
                            if (dispatch) {
                                dispatch(state.tr.insertText('\t'));
                            }
                            return true;
                        },
                        Enter: newlineInCode,
                        'Mod-Enter': (_, dispatch) => {
                            if (dispatch) {
                                const { state } = outerView;
                                const { to } = state.selection;
                                const tr = state.tr.replaceWith(to, to, state.schema.nodes.paragraph.createAndFill());
                                outerView.dispatch(tr.setSelection(TextSelection.create(tr.doc, to)));
                                outerView.focus();
                            }

                            return true;
                        },
                    }),
                ],
            }),
            dispatchTransaction: (tr) => {
                if (!innerView) return;
                const { state, transactions } = innerView.state.applyTransaction(tr);
                innerView.updateState(state);

                if (!tr.getMeta('fromOutside')) {
                    const outerTr = outerView.state.tr;
                    const offsetMap = StepMap.offset(getPos() + 1);

                    transactions.forEach((transaction) => {
                        const { steps } = transaction;
                        steps.forEach((step) => {
                            const mapped = step.map(offsetMap);

                            if (!mapped) {
                                throw Error('step discarded!');
                            }
                            outerTr.step(mapped);
                        });
                    });
                    if (outerTr.docChanged) outerView.dispatch(outerTr);
                }
            },
        });
        innerView.focus();
        const { state } = innerView;
        innerView.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0)));
        isEditing = true;
    };

    const closeEditor = () => {
        if (innerView) {
            innerView.destroy();
        }
        innerView = undefined;
        isEditing = false;
    };

    return {
        isEditing: () => isEditing,
        innerView: () => innerView,
        openEditor,
        closeEditor,
    };
};

export const innerEditor = (manager: ThemeManager, emotion: Emotion) => {
    const { codeStyle, hideCodeStyle, previewPanelStyle } = getStyle(manager, emotion);
    manager.setCustom(ThemeInnerEditor, ({ view, getPos, render }) => {
        const inner$ = createInnerEditor(view, getPos);
        const dom = document.createElement('div');
        dom.classList.add('math-block');
        const editor = document.createElement('div');

        if (codeStyle && hideCodeStyle) {
            editor.classList.add(codeStyle, hideCodeStyle);
        }

        const preview = document.createElement('div');
        if (previewPanelStyle) {
            preview.classList.add(previewPanelStyle);
        }

        dom.append(editor);

        return {
            dom,
            preview,
            editor,
            onUpdate: (node, isInit) => {
                if (isInit) {
                    editor.dataset['value'] = node.attrs['value'];
                    render(node.attrs['value']);
                    return;
                }

                const innerView = inner$.innerView();
                if (innerView) {
                    const state = innerView.state;
                    const start = node.content.findDiffStart(state.doc.content);
                    if (start != null) {
                        const diff = node.content.findDiffEnd(state.doc.content);
                        if (diff) {
                            let { a: endA, b: endB } = diff;
                            const overlap = start - Math.min(endA, endB);
                            if (overlap > 0) {
                                endA += overlap;
                                endB += overlap;
                            }
                            innerView.dispatch(
                                state.tr.replace(start, endB, node.slice(start, endA)).setMeta('fromOutside', true),
                            );
                        }
                    }
                }

                const newVal = node.content.firstChild?.text || '';
                editor.dataset['value'] = newVal;

                render(newVal);
            },
            onFocus: (node) => {
                if (!view.editable) return;
                if (hideCodeStyle) {
                    editor.classList.remove(hideCodeStyle);
                }
                inner$.openEditor(editor, node);
                dom.classList.add('ProseMirror-selectednode');
            },
            onBlur: () => {
                if (hideCodeStyle) {
                    editor.classList.add(hideCodeStyle);
                }
                inner$.closeEditor();
                dom.classList.remove('ProseMirror-selectednode');
            },
            onDestroy: () => {
                preview.remove();
                editor.remove();
                dom.remove();
            },
            stopEvent: (event) => {
                const innerView = inner$.innerView();
                const { target } = event;
                const isChild = target && innerView?.dom.contains(target as Element);
                return !!(innerView && isChild);
            },
        };
    });
};