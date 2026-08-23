import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatAnchorLabel } from "../review/reviewCoordinates";
import type { ReviewAnchor, ReviewComment } from "../review/reviewTypes";
import { actionMenuPanelStyle } from "./actionMenu";
import { createMobilePromptEnterMedia, readPromptEnterPreference, shouldSendPromptOnEnterShortcut } from "../promptEnterBehavior";

/** An in-progress, not-yet-saved comment rendered alongside saved ones. */
export interface ReviewThreadDraft {
  anchor: ReviewAnchor;
  body: string;
}

/**
 * Inline comment card: renders saved comments for a line/anchor plus an
 * optional in-progress draft. Registered as a standalone custom element so
 * it mounts from a CM6 block widget or a plugin's own DOM tree.
 */
@customElement("pi-web-review-thread")
export class ReviewThread extends LitElement {
  @property({ attribute: false }) comments: readonly ReviewComment[] = [];
  @property({ attribute: false }) draft: ReviewThreadDraft | undefined;
  @property({ attribute: false }) onSubmitDraft?: (body: string) => void;
  @property({ attribute: false }) onCancelDraft?: () => void;
  @property({ attribute: false }) onUpdate?: (id: string, body: string) => void;
  @property({ attribute: false }) onRemove?: (id: string) => void;

  /** Which saved comment (if any) is currently swapped into edit mode. */
  @state() private editingCommentId: string | undefined;
  @state() private editingBody = "";
  @state() private draftBody = "";
  @state() private openMenuCommentId: string | undefined;
  @state() private menuStyle = "";

  private readonly mobilePromptEnterMedia = createMobilePromptEnterMedia();

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuCommentId = undefined;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("draft")) this.draftBody = this.draft?.body ?? "";
    if (changed.has("comments") && this.editingCommentId !== undefined && !this.comments.some((comment) => comment.id === this.editingCommentId)) {
      this.editingCommentId = undefined;
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="thread">
        ${this.comments.map((comment) => this.renderComment(comment))}
        ${this.draft === undefined ? null : this.renderDraft(this.draft)}
      </div>
    `;
  }

  private renderComment(comment: ReviewComment): TemplateResult {
    if (this.editingCommentId === comment.id) return this.renderEditingComment(comment);
    const menuOpen = this.openMenuCommentId === comment.id;
    return html`
      <div class="card">
        <div class="card-header">
          <small class="caption">${formatAnchorLabel(comment.anchor)}</small>
          <div class="action-menu">
            <button
              type="button"
              class="action-menu-toggle"
              title="Comment actions"
              aria-label="Comment actions"
              aria-expanded=${String(menuOpen)}
              @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(comment.id, event.currentTarget); }}
            >⋯</button>
            ${menuOpen ? html`
              <div class="action-menu-panel" style=${this.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
                <button type="button" @click=${() => { this.beginEdit(comment); }}>Edit</button>
                <button type="button" class="danger" @click=${() => { this.openMenuCommentId = undefined; this.onRemove?.(comment.id); }}>Delete</button>
              </div>
            ` : null}
          </div>
        </div>
        <p class="body">${comment.body}</p>
      </div>
    `;
  }

  private renderEditingComment(comment: ReviewComment): TemplateResult {
    return html`
      <div class="card">
        <small class="caption">${formatAnchorLabel(comment.anchor)}</small>
        <textarea
          class="editor"
          rows="3"
          .value=${this.editingBody}
          @input=${(event: Event) => { if (event.target instanceof HTMLTextAreaElement) this.editingBody = event.target.value; }}
          @keydown=${(event: KeyboardEvent) => { this.handleEditingKeydown(event); }}
        ></textarea>
        <div class="editor-actions">
          <button type="button" class="primary" ?disabled=${this.editingBody.trim() === ""} @click=${() => { this.saveEdit(comment.id); }}>Save</button>
          <button type="button" @click=${() => { this.cancelEdit(); }}>Cancel</button>
        </div>
      </div>
    `;
  }

  private renderDraft(draft: ReviewThreadDraft): TemplateResult {
    return html`
      <div class="card draft">
        <small class="caption">${formatAnchorLabel(draft.anchor)}</small>
        <textarea
          class="editor"
          rows="3"
          placeholder="Leave a comment…"
          .value=${this.draftBody}
          @input=${(event: Event) => { if (event.target instanceof HTMLTextAreaElement) this.draftBody = event.target.value; }}
          @keydown=${(event: KeyboardEvent) => { this.handleDraftKeydown(event); }}
        ></textarea>
        <div class="editor-actions">
          <button type="button" class="primary" ?disabled=${this.draftBody.trim() === ""} @click=${() => { this.submitDraft(); }}>Comment</button>
          <button type="button" @click=${() => { this.onCancelDraft?.(); }}>Cancel</button>
        </div>
      </div>
    `;
  }

  /** No-ops for a blank/whitespace-only body -- an empty comment carries no signal and is not worth persisting. Mirrors the `?disabled` guard on the "Comment" button as a belt-and-suspenders check. */
  private submitDraft(): void {
    if (this.draftBody.trim() === "") return;
    this.onSubmitDraft?.(this.draftBody);
  }

  private toggleMenu(commentId: string, target: EventTarget | null): void {
    if (this.openMenuCommentId === commentId) {
      this.openMenuCommentId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuCommentId = commentId;
  }

  private beginEdit(comment: ReviewComment): void {
    this.openMenuCommentId = undefined;
    this.editingCommentId = comment.id;
    this.editingBody = comment.body;
  }

  /** No-ops for a blank/whitespace-only body, mirroring `submitDraft`'s guard (belt-and-suspenders alongside the `?disabled` guard on the "Save" button). */
  private saveEdit(commentId: string): void {
    const body = this.editingBody;
    if (body.trim() === "") return;
    this.editingCommentId = undefined;
    this.onUpdate?.(commentId, body);
  }

  private cancelEdit(): void {
    this.editingCommentId = undefined;
  }

  private handleDraftKeydown(event: KeyboardEvent): void {
    this.handleCommentEditorKeydown(event, this.draftBody, () => { this.submitDraft(); });
  }

  private handleEditingKeydown(event: KeyboardEvent): void {
    const commentId = this.editingCommentId;
    if (commentId === undefined) return;
    this.handleCommentEditorKeydown(event, this.editingBody, () => { this.saveEdit(commentId); });
  }

  private handleCommentEditorKeydown(event: KeyboardEvent, body: string, onSubmit: () => void): void {
    if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
    const shouldSubmit = shouldSendPromptOnEnterShortcut(event.shiftKey, this.mobilePromptEnterMedia, readPromptEnterPreference());
    if (shouldSubmit && body.trim() !== "") {
      event.preventDefault();
      onSubmit();
    }
  }

  static override styles = css`
    /*
     * BUG FIX: this element is mounted as a light-DOM child of CodeMirror's
     * .cm-content (Files tab) or inside a diff row (Git tab), both of which
     * set white-space: break-spaces / pre for code display -- an INHERITED
     * property. Without an explicit reset here, :host inherits that value,
     * and the plain indentation/newline whitespace text nodes that Lit's
     * own multi-line html-tagged template literal produces around .thread
     * render as literal, visible, wrapped multi-line content instead of
     * collapsing (normal HTML whitespace behavior), adding an unexplained
     * gap above and below the actual card.
     */
    :host { display: block; white-space: normal; padding: 0.2em 0.4em; color: var(--pi-text); font: 13px system-ui, sans-serif; }
    .thread { display: flex; flex-direction: column; gap: 8px; }
    .card { box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--pi-border-muted); border-radius: 8px; background: var(--pi-surface); }
    .card.draft { background: var(--pi-selection-bg); }
    .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .caption { color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
    .body { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .action-menu { position: relative; align-self: flex-start; }
    .action-menu-toggle { display: grid; place-items: center; min-width: 24px; padding: 0 4px; border: 0; background: transparent; color: var(--pi-muted); cursor: pointer; }
    .action-menu-toggle:hover { color: var(--pi-text); }
    .action-menu-panel { position: fixed; z-index: 50; box-sizing: border-box; min-width: min(120px, calc(100vw - 16px)); overflow: auto; padding: 4px; border: 1px solid var(--pi-border-muted); border-radius: 8px; background: var(--pi-surface); }
    .action-menu-panel button { display: block; width: 100%; border: 0; border-radius: 5px; background: transparent; color: var(--pi-text); padding: 5px 7px; text-align: left; cursor: pointer; }
    .action-menu-panel button:hover { background: var(--pi-selection-bg); }
    .action-menu-panel button.danger { color: var(--pi-danger); }
    .editor { box-sizing: border-box; width: 100%; min-height: 54px; resize: vertical; border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text); caret-color: var(--pi-accent); padding: 6px 8px; font: inherit; }
    .editor-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .editor-actions button { border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); padding: 6px 10px; font: inherit; cursor: pointer; }
    .editor-actions button:hover { background: var(--pi-bg); }
    .editor-actions button.primary { border-color: var(--pi-accent); color: var(--pi-accent); }
    .editor-actions button.primary:hover { background: color-mix(in srgb, var(--pi-accent) 8%, var(--pi-surface)); }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-web-review-thread": ReviewThread;
  }
}
