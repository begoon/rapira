<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { bracketMatching, foldGutter } from '@codemirror/language';
  import { rapira } from './rapira-mode.ts';

  interface Props {
    initial: string;
    onChange: (s: string) => void;
  }

  let { initial, onChange }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;

  onMount(() => {
    if (!host) return;
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        bracketMatching(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        rapira(),
        EditorView.theme({
          '&':          { backgroundColor: 'var(--bg)', color: 'var(--fg)' },
          '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
          '.cm-activeLine':        { backgroundColor: 'rgba(255,255,255,0.04)' },
          '.cm-activeLineGutter':  { backgroundColor: 'rgba(255,255,255,0.06)' },
          '.cm-content':           { caretColor: 'var(--accent)' },
        }, { dark: true }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    });
    view = new EditorView({ state, parent: host });
  });

  onDestroy(() => view?.destroy());
</script>

<div bind:this={host} class="editor-host"></div>

<style>
  .editor-host { height: 100%; }
  :global(.cm-editor) { height: 100%; }
</style>
