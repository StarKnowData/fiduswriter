import {Comment} from "./comment"
import {
    addCommentDuringCreationDecoration,
    removeCommentDuringCreationDecoration
} from "../statePlugins"

export class ModCommentStore {
    constructor(mod) {
        mod.store = this
        this.mod = mod
        // a comment object for a comment that is still under construction
        this.commentDuringCreation = false
        this.reset()
    }

    reset() {
        this.comments = Object.create(null)
        this.unsent = []
    }

    mustSend() {
        // Set a timeout so that the update can be combines with other updates
        // if they happen more or less simultaneously.
        window.setTimeout(
            () => this.mod.editor.mod.collab.docChanges.sendToCollaborators(),
            100
        )
    }
    // Create a new temporary comment. This one is not going into the store yet,
    // as it is empty, shouldn't be shared and if canceled, it should go away
    // entirely.
    addCommentDuringCreation() {
        let id = -1
        this.commentDuringCreation = {
            comment: new Comment(
                id,
                this.mod.editor.user.id,
                this.mod.editor.user.name,
                this.mod.editor.user.avatar,
                new Date().getTime(),
                ''),
            inDOM: false
        }
        let transaction = addCommentDuringCreationDecoration(this.mod.editor.view.state)
        if (transaction) {
            this.mod.editor.view.dispatch(transaction)
        }

    }

    removeCommentDuringCreation() {
        if (this.commentDuringCreation) {
            this.commentDuringCreation = false
            let transaction = removeCommentDuringCreationDecoration(this.mod.editor.view.state)
            if (transaction) {
                this.mod.editor.view.dispatch(transaction)
            }
        }
    }

    // Add a new comment to the comment database both remotely and locally.
    addComment(user, userName, userAvatar, date, comment, isMajor, posFrom, posTo) {
        let id = randomID()
        this.addLocalComment(id, user, userName, userAvatar, date, comment, [], isMajor, true)
        this.unsent.push({
            type: "create",
            id: id
        })
        let markType = this.mod.editor.view.state.schema.marks.comment.create({id})
        this.mod.editor.view.dispatch(
            this.mod.editor.view.state.tr.addMark(posFrom, posTo, markType)
        )
        this.mustSend()
    }


    moveComment(id, pos) {
        // The content to which a comment was linked has been removed.
        // We need to find text close to the position to which we can link
        // comment. This is user for reviewer comments that should not be lost.

        let markType = this.mod.editor.view.state.schema.marks.comment.create({id})
        let doc = this.mod.editor.view.state.doc
        let posFrom = pos-1
        let posTo = pos
        // We move backward through the document, trying to pick a start position
        // the depth is 1 between document parts, and comments should be moved
        // across these.
        // We decrease the from position until there is some text between posFrom
        // and posTo or until we hit the start of the document part.
        while (
            doc.resolve(posFrom).depth > 1 &&
            !doc.textBetween(posFrom, posTo).length
        ) {
            posFrom--
        }
        // If we ended up reaching a document part boundary rather than finding
        // text, we try again, this time moving in the opposite direction.
        // We start at the original position and then increase posTo
        if (doc.resolve(posFrom).depth === 1){
            posFrom = posTo
            posTo++
            while (
                doc.resolve(posTo).depth > 1 &&
                !doc.textBetween(posFrom, posTo).length
            ) {
                posTo++
            }

            // If also the increase of posTo only made us reach a document part
            // boundary, it means all text has been removed. So now we insert a
            // single space which we can link to.
            if (doc.resolve(posTo).depth === 1) {
                this.mod.editor.view.dispatch(
                    this.mod.editor.view.state.tr.insertText(posFrom,' ')
                )
                posTo = posFrom + 1
            }
        }
        this.mod.editor.view.dispatch(
            this.mod.editor.view.state.tr.addMark(posFrom, posTo, markType)
        )
    }

    addLocalComment(id, user, userName, userAvatar, date, comment, answers, isMajor, local) {
        if (!this.comments[id]) {
            this.comments[id] = new Comment(id, user, userName, userAvatar, date, comment, answers, isMajor)
        }
        if (local || (!this.mod.layout.isCurrentlyEditing())) {
            this.mod.layout.layoutComments()
        }
    }

    updateComment(id, comment, commentIsMajor) {
        this.updateLocalComment(id, comment, commentIsMajor, true)
        this.unsent.push({
            type: "update",
            id: id
        })
        this.mustSend()
    }

    updateLocalComment(id, comment, commentIsMajor, local) {
        if (this.comments[id]) {
            this.comments[id].comment = comment
            this.comments[id]['review:isMajor'] = commentIsMajor
        }
        if (local || (!this.mod.layout.isCurrentlyEditing())) {
            this.mod.layout.layoutComments()
        }
    }

    removeCommentMarks(id) {
        this.mod.editor.view.state.doc.descendants((node, pos, parent) => {
            let nodeStart = pos
            let nodeEnd = pos + node.nodeSize
            for (let i =0; i < node.marks.length; i++) {
                let mark = node.marks[i]
                if (mark.type.name === 'comment' && parseInt(mark.attrs.id) === id) {
                    let markType = this.mod.editor.view.state.schema.marks.comment.create({id})
                    this.mod.editor.view.dispatch(
                        this.mod.editor.view.state.tr.removeMark(nodeStart, nodeEnd, markType)
                    )
                }
            }
        })
    }

    deleteLocalComment(id, local) {
        let found = this.comments[id]
        if (found) {
            delete this.comments[id]
            return true
        }
        if (local || (!this.mod.layout.isCurrentlyEditing())) {
            this.mod.layout.layoutComments()
        }
    }

    // Removes the comment from store, optionally also removes marks from document.
    deleteComment(id, removeMarks) {
        if (this.deleteLocalComment(id, true)) {
            this.unsent.push({
                type: "delete",
                id: id
            })
            if (removeMarks) {
                this.removeCommentMarks(id)
            }
            this.mustSend()
        }
    }

    checkAndMove(ids) {
        // Check if there is still a node referring to the comment IDs that
        // were in the deleted content.
        this.mod.editor.view.state.doc.descendants((node, pos, parent) => {
            if (!node.isInline) {
                return
            }
            let id = this.mod.layout.findCommentId(node)
            if (id && ids.indexOf(id) !== -1) {
                ids.splice(ids.indexOf(id),1)
            }
        })

        // Move the comment to a piece of text nearby, unless the
        ids.forEach(id => {
            let pos = this.mod.editor.view.state.selection.from
            this.moveComment(
                id,
                pos
            )
        })
    }


    addLocalAnswer(id, answer, local) {
        if (this.comments[id]) {
            if (!this.comments[id].answers) {
                this.comments[id].answers = []
            }
            this.comments[id].answers.push(answer)
        }

        if (local || (!this.mod.layout.isCurrentlyEditing())) {
            this.mod.layout.layoutComments()
        }
    }

    addAnswer(id, answer) {
        answer.id = randomID()
        this.addLocalAnswer(id, answer, true)
        this.unsent.push({
            type: "add_answer",
            id,
            answerId: answer.id
        })
        this.mustSend()
    }

    deleteLocalAnswer(id, answerId, local) {
        if (this.comments[id] && this.comments[id].answers) {
            this.comments[id].answers = this.comments[id].answers.filter(answer => answer.id !== answerId)
        }
        if (local || (!this.mod.layout.isCurrentlyEditing())) {
            this.mod.layout.layoutComments()
        }
    }

    deleteAnswer(id, answerId) {
        this.deleteLocalAnswer(id, answerId, true)
        this.unsent.push({
            type: "delete_answer",
            id,
            answerId
        })
        this.mustSend()
    }

    updateLocalAnswer(id, answerId, answerText, local) {
        if (this.comments[id] && this.comments[id].answers) {
            let answer = this.comments[id].answers.find(answer => answer.id === answerId)
            if (answer) {
                answer.answer = answerText
            }
        }
        if (local || (!this.mod.layout.isCurrentlyEditing())) {
            this.mod.layout.layoutComments()
        }
    }

    updateAnswer(id, answerId, answerText) {
        this.updateLocalAnswer(id, answerId, answerText, true)
        this.unsent.push({
            type: "update_answer",
            id,
            answerId
        })
        this.mustSend()
    }

    unsentEvents() {
        let result = []
        for (let i = 0; i < this.unsent.length; i++) {
            let event = this.unsent[i]
            if (event.type == "delete") {
                result.push({
                    type: "delete",
                    id: event.id
                })
            } else if (event.type == "update") {
                let found = this.comments[event.id]
                if (found && found.id) {
                    result.push({
                        type: "update",
                        id: found.id,
                        comment: found.comment,
                        'review:isMajor': found['review:isMajor']
                    })
                } else {
                    result.push({
                        type: "ignore"
                    })
                }
            } else if (event.type == "create") {
                let found = this.comments[event.id]
                if (found && found.id) {
                    result.push({
                        type: "create",
                        id: found.id,
                        user: found.user,
                        userName: found.userName,
                        userAvatar: found.userAvatar,
                        date: found.date,
                        comment: found.comment,
                        answers: found.answers,
                        'review:isMajor': found['review:isMajor']
                    })
                } else {
                    result.push({
                        type: "ignore"
                    })
                }
            } else if (event.type == "add_answer") {
                let found = this.comments[event.id], foundAnswer
                if (found && found.id && found.answers) {
                    foundAnswer = found.answers.find(answer => answer.id === event.answerId)
                }
                if (foundAnswer) {
                    result.push({
                        type: "add_answer",
                        answerId: foundAnswer.id,
                        id: event.id,
                        user: foundAnswer.user,
                        userName: foundAnswer.userName,
                        userAvatar: foundAnswer.userAvatar,
                        date: foundAnswer.date,
                        answer: foundAnswer.answer
                    })
                } else {
                    result.push({
                        type: "ignore"
                    })
                }
            } else if (event.type == "delete_answer") {
                let found = this.comments[event.id]
                if (found && found.id && found.answers) {
                    result.push({
                        type: "delete_answer",
                        id: event.id,
                        answerId: event.answerId
                    })
                } else {
                    result.push({
                        type: "ignore"
                    })
                }
            } else if (event.type == "update_answer") {
                let found = this.comments[event.id], foundAnswer
                if (found && found.id && found.answers) {
                    foundAnswer = found.answers.find(answer => answer.id === event.answerId)
                }
                if (foundAnswer) {
                    result.push({
                        type: "update_answer",
                        id: event.id,
                        answerId: event.answerId,
                        answer: foundAnswer.answer
                    })
                } else {
                    result.push({
                        type: "ignore"
                    })
                }
            }
        }
        return result
    }

    eventsSent(n) {
        this.unsent = this.unsent.slice(n.length)
    }

    receive(events) {
        events.forEach(event => {
            if (event.type == "delete") {
                this.deleteLocalComment(event.id, false)
            } else if (event.type == "create") {
                this.addLocalComment(event.id, event.user, event.userName, event.userAvatar, event.date, event.comment, [], event['review:isMajor'], false)
            } else if (event.type == "update") {
                this.updateLocalComment(event.id, event.comment, event['review:isMajor'], false)
            } else if (event.type == "add_answer") {
                this.addLocalAnswer(event.id, event, false)
            } else if (event.type == "delete_answer") {
                this.deleteLocalAnswer(event.id, event.answerId, false)
            } else if (event.type == "update_answer") {
                this.updateLocalAnswer(event.id, event.answerId, event.answer, false)
            }
        })

    }

}

function randomID() {
    return Math.floor(Math.random() * 0xffffffff)
}
