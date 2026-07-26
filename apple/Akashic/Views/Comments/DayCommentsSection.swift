import SwiftUI

/// Destructive-action red for the comments UI (web parity: `colors.accent.error` ≈ #EF4444).
/// Defined locally because the shared `Theme` (out of scope tonight) has no danger colour.
private let commentDanger = Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)

/// Day-comments section shown at the bottom of `DayDetailSheet` — native parity with the web
/// `DayCommentsSection` (`src/components/comments/*`).
///
/// Renders a day's comment thread (author, relative timestamp, content, an "(edited)" marker),
/// with swipe-to-reveal **Edit / Delete** on the local user's own comments, inline editing, a
/// delete confirmation, and a composer with a live character counter near the 2000-char limit.
/// Because the app has no signed-in user and Settings is out of scope tonight, the "Your name"
/// identity is collected inline the first time the user posts.
///
/// Styling follows `DayDetailSheet`'s dark liquid-glass language (`.ultraThinMaterial` fills +
/// `Theme.hairline` strokes over the night-sky background).
struct DayCommentsSection: View {
    @EnvironmentObject private var store: JourneyStore

    let camp: Camp
    let journeyId: String

    @State private var comments: [DayComment] = []
    @State private var draft: String = ""
    @State private var pendingName: String = ""
    @State private var hasName: Bool = true
    @State private var isSending = false

    private var service: CommentService { store.commentService }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(icon: "💬", title: "Comments",
                         trailing: comments.isEmpty ? nil : "\(comments.count)")

            if comments.isEmpty {
                Text("No comments yet")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 14)
            } else {
                VStack(spacing: 8) {
                    ForEach(comments) { comment in
                        CommentRow(
                            comment: comment,
                            onUpdate: { updateComment(comment, content: $0) },
                            onDelete: { deleteComment(comment) }
                        )
                    }
                }
            }

            composer
        }
        .onAppear(perform: load)
        .onChange(of: camp.id) { _, _ in load() }
    }

    // MARK: - Composer

    @ViewBuilder
    private var composer: some View {
        if hasName {
            HStack(alignment: .bottom, spacing: 8) {
                ZStack(alignment: .bottomTrailing) {
                    TextField("Comment on Day \(camp.dayNumber)…", text: $draft, axis: .vertical)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1...5)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .padding(.trailing, isNearLimit ? 44 : 0)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Theme.hairline, lineWidth: 1)
                        )
                        .disabled(isSending)
                        // QUA-07: the counter that appears near the limit is a separate element
                        // floating inside the field's own frame, so it was announced after the field
                        // rather than as part of it — and only over 1 800 characters, exactly when it
                        // matters. As the field's value it arrives with the field.
                        .accessibilityValue(isNearLimit
                                            ? Text("\(draft.count) of \(CommentService.maxLength) characters")
                                            : Text(draft))

                    if isNearLimit {
                        Text("\(draft.count)/\(CommentService.maxLength)")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(isOverLimit ? commentDanger : Theme.textTertiary)
                            .padding(.trailing, 10)
                            .padding(.bottom, 8)
                            .accessibilityHidden(true)
                    }
                }

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(canSend ? Theme.accent : Theme.textTertiary)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel("Send comment")
            }
        } else {
            // Inline first-comment identity prompt (no Settings screen tonight).
            VStack(alignment: .leading, spacing: 8) {
                Text("Add your name to comment")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.textSecondary)
                HStack(spacing: 8) {
                    TextField("Your name", text: $pendingName)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textPrimary)
                        .textInputAutocapitalization(.words)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Theme.hairline, lineWidth: 1)
                        )
                        .onSubmit(saveName)

                    Button("Continue", action: saveName)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(canSaveName ? Theme.accent : Theme.textTertiary)
                        .disabled(!canSaveName)
                }
            }
            .padding(12)
            .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var isNearLimit: Bool { draft.count > Int(Double(CommentService.maxLength) * 0.9) }
    private var isOverLimit: Bool { draft.count > CommentService.maxLength }
    private var canSend: Bool { !trimmedDraft.isEmpty && !isOverLimit && !isSending }
    private var canSaveName: Bool {
        !pendingName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Actions

    private func load() {
        service.seedDemoCommentsIfRequested(waypointID: camp.id, journeyID: journeyId)
        hasName = service.hasAuthorName
        comments = service.comments(forWaypoint: camp.id)
    }

    private func send() {
        guard canSend else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try service.create(waypointID: camp.id, journeyID: journeyId, content: draft)
            draft = ""
            comments = service.comments(forWaypoint: camp.id)
        } catch {
            // Validation failures are already prevented by `canSend`; swallow to keep the UI calm.
        }
    }

    private func saveName() {
        guard canSaveName else { return }
        service.authorName = pendingName
        hasName = service.hasAuthorName
        pendingName = ""
    }

    private func updateComment(_ comment: DayComment, content: String) {
        _ = try? service.update(commentID: comment.id, content: content)
        comments = service.comments(forWaypoint: camp.id)
    }

    private func deleteComment(_ comment: DayComment) {
        _ = service.delete(commentID: comment.id)
        comments = service.comments(forWaypoint: camp.id)
    }
}

// MARK: - Comment row

/// One comment. Static for other people's comments; for the local user's own comments it adds a
/// horizontal swipe that reveals Edit + Delete, inline editing, and a delete confirmation.
private struct CommentRow: View {
    let comment: DayComment
    var onUpdate: (String) -> Void
    var onDelete: () -> Void

    @State private var offset: CGFloat = 0
    @State private var isEditing = false
    @State private var editText = ""
    @State private var confirmingDelete = false

    private let actionsWidth: CGFloat = 108

    /// The avatar initial was sized to fit a fixed 26 pt circle; scale the circle with the
    /// glyph (`.caption`, matching the old 12 pt) so a growing letter doesn't outgrow it.
    @ScaledMetric(relativeTo: .caption) private var avatarSize: CGFloat = 26

    /// The swipe-action icons were sized to fit a fixed 46 pt square; scale the square with the
    /// glyph (`.subheadline`, the old 15 pt) for the same reason as `DayDetailSheet.chevronBoxSize`.
    @ScaledMetric(relativeTo: .subheadline) private var actionButtonSize: CGFloat = 46

    private var swipeEnabled: Bool { comment.isMine && !isEditing }

    var body: some View {
        ZStack(alignment: .trailing) {
            if swipeEnabled {
                swipeActions
                    // QUA-07: these two buttons sit *behind* the card and are revealed by a custom
                    // horizontal `DragGesture`. VoiceOver cannot perform that drag, so as elements
                    // they were two unlabelled glyphs at a screen position with nothing on it — while
                    // the real affordance, editing or deleting your own comment, was unreachable. The
                    // named actions below are the accessible equivalent: they appear in the Actions
                    // rotor on the comment itself, which is where a reader looks for them.
                    .accessibilityHidden(true)
            }
            cardWithSwipe
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: offset)
        .accessibilityActions {
            if comment.isMine, !isEditing {
                Button("Edit comment") {
                    editText = comment.content
                    isEditing = true
                    resetOffset()
                }
                Button("Delete comment") { confirmingDelete = true }
            }
        }
        .accessibilityHint(comment.isMine && !isEditing
                           ? "Edit and Delete actions are available"
                           : "")
        .confirmationDialog("Delete this comment?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { onDelete() }
            Button("Cancel", role: .cancel) { resetOffset() }
        }
    }

    /// The card, with the reveal swipe attached only for the owner's non-editing rows.
    /// (`.gesture` has no `nil` overload, so the gesture is added conditionally here.)
    @ViewBuilder
    private var cardWithSwipe: some View {
        if swipeEnabled {
            card
                .offset(x: offset)
                .gesture(swipe)
        } else {
            card
        }
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                avatar
                Text(comment.authorName)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(CommentTime.relative(comment.createdAt))
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
                if comment.wasEdited {
                    Text("(edited)")
                        .font(.caption2)
                        .italic()
                        .foregroundStyle(Theme.textTertiary)
                }
                Spacer(minLength: 0)
            }
            // Author, when, and whether it was edited are one attribution line.
            .accessibilityElement(children: .combine)

            if isEditing {
                editor
            } else {
                Text(comment.content)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }

    private var avatar: some View {
        Text(String(comment.authorName.first ?? "?").uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.textSecondary)
            .frame(width: avatarSize, height: avatarSize)
            .background(Theme.accentSoft, in: Circle())
            // A single initial standing in for a face. The name is spelled out beside it, so this
            // adds a stray letter and nothing else.
            .accessibilityHidden(true)
    }

    // MARK: Inline editor

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Edit comment", text: $editText, axis: .vertical)
                .font(.footnote)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1...6)
                .padding(8)
                // A black-opacity "recessed field" tint only reads as recessed on the fixed
                // dark background this sheet used to assume; `Theme.fillSubtle` is the
                // system's own answer and adapts with appearance and contrast on its own.
                .background(Theme.fillSubtle, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Theme.hairline, lineWidth: 1)
                )

            HStack(spacing: 10) {
                Button("Save") {
                    let trimmed = editText.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { onUpdate(trimmed) }
                    isEditing = false
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .disabled(editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("Cancel") { isEditing = false }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
    }

    // MARK: Swipe actions

    private var swipeActions: some View {
        HStack(spacing: 8) {
            actionButton(system: "pencil", tint: Theme.accent) {
                editText = comment.content
                isEditing = true
                resetOffset()
            }
            actionButton(system: "trash", tint: commentDanger) {
                confirmingDelete = true
            }
        }
        .padding(.trailing, 2)
    }

    private func actionButton(system: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: actionButtonSize, height: actionButtonSize)
                .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: Gesture

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                // Only react to horizontal drags so the sheet's vertical scroll keeps working.
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                offset = min(0, max(-actionsWidth, value.translation.width))
            }
            .onEnded { value in
                offset = value.translation.width < -actionsWidth / 2 ? -actionsWidth : 0
            }
    }

    private func resetOffset() { offset = 0 }
}

// MARK: - Relative time (web parity: CommentItem.formatRelativeTime)

enum CommentTime {
    /// "just now" / "2 min ago" / "5 hr ago" / "3 days ago" (≤ 30 days), else a short date.
    ///
    /// The four relative forms come from `RelativeDateTimeFormatter`, not from hand-built strings.
    /// The previous version composed "\(minutes)m ago" itself, which is untranslatable twice over:
    /// the word "ago" is a literal no catalogue could see, and the "m"/"h"/"d" abbreviations and
    /// their position relative to the number are language-specific (Norwegian says "for 5 min
    /// siden" — the marker goes *before* the number). Foundation already knows this for every
    /// language Apple ships, including the plural rules, so the only thing left to decide here is
    /// the *unit* to express the gap in.
    static func relative(_ date: Date, now: Date = Date(), locale: Locale = .current) -> String {
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 {
            return String(localized: "just now",
                          comment: "Comment timestamp for something posted less than a minute ago.")
        }
        let f = relativeFormatter(locale)
        let minutes = seconds / 60
        if minutes < 60 { return f.localizedString(from: DateComponents(minute: -minutes)) }
        let hours = minutes / 60
        if hours < 24 { return f.localizedString(from: DateComponents(hour: -hours)) }
        let days = hours / 24
        if days <= 30 { return f.localizedString(from: DateComponents(day: -days)) }
        return shortDate(locale).string(from: date)
    }

    private static func relativeFormatter(_ locale: Locale) -> RelativeDateTimeFormatter {
        let f = RelativeDateTimeFormatter()
        f.locale = locale
        // `.short` keeps the compactness the abbreviations were there for ("5 min ago" rather than
        // "5 minutes ago") without hardcoding what "short" looks like in any one language.
        f.unitsStyle = .short
        return f
    }

    /// A day-and-month date for comments older than a month. Built from a template so the locale
    /// picks the order and the separator: `en_US` "Sep 29", `en_GB` "29 Sep", `nb` "29. sep.".
    /// The old fixed "MMM d" against `en_US_POSIX` gave every language the American form.
    private static func shortDate(_ locale: Locale) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.setLocalizedDateFormatFromTemplate("dMMM")
        return f
    }
}
