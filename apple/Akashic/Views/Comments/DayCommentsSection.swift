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
                    .font(.system(size: 13))
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
                        .font(.system(size: 14))
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

                    if isNearLimit {
                        Text("\(draft.count)/\(CommentService.maxLength)")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(isOverLimit ? commentDanger : Theme.textTertiary)
                            .padding(.trailing, 10)
                            .padding(.bottom, 8)
                    }
                }

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
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
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                HStack(spacing: 8) {
                    TextField("Your name", text: $pendingName)
                        .font(.system(size: 14))
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
                        .font(.system(size: 13, weight: .semibold))
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

    private var swipeEnabled: Bool { comment.isMine && !isEditing }

    var body: some View {
        ZStack(alignment: .trailing) {
            if swipeEnabled {
                swipeActions
            }
            cardWithSwipe
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: offset)
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
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(CommentTime.relative(comment.createdAt))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
                if comment.wasEdited {
                    Text("(edited)")
                        .font(.system(size: 11))
                        .italic()
                        .foregroundStyle(Theme.textTertiary)
                }
                Spacer(minLength: 0)
            }

            if isEditing {
                editor
            } else {
                Text(comment.content)
                    .font(.system(size: 13))
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
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
            .frame(width: 26, height: 26)
            .background(Theme.accentSoft, in: Circle())
    }

    // MARK: Inline editor

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Edit comment", text: $editText, axis: .vertical)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1...6)
                .padding(8)
                .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .disabled(editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("Cancel") { isEditing = false }
                    .font(.system(size: 12, weight: .medium))
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
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 46, height: 46)
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
    /// "just now" / "Xm ago" / "Xh ago" / "Xd ago" (≤ 30 days), else a short "MMM d" date.
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days <= 30 { return "\(days)d ago" }
        return shortDateFormatter.string(from: date)
    }

    private static let shortDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM d"
        return f
    }()
}
