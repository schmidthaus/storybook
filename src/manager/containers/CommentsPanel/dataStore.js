import deepEquals from 'deep-equal';

export default class DataStore {
  constructor(db) {
    this.db = db;
    this.currentStory = null;
    this.callbacks = [];
    this.cache = {};
    this.users = {};
    this.user = null;
  }

  setCurrentStory(sbKind, sbStory) {
    this.currentStory = { sbKind, sbStory };
    const key = this._getStoryKey(this.currentStory);
    this._fireComments(this.cache[key] || []);

    // Load comments.
    this._loadUsers()
      .then(() => this._loadComments())
  }

  setCurrentUser(user) {
    this.user = user;
  }

  _loadUsers() {
    const query = {};
    const options = {limit: 1e6};
    return this.db.getCollection('users')
      .get(query, options)
      .then((users) => {
        this.users = users.reduce((newUsers, user) => {
          newUsers[user.id] = user;
          return newUsers;
        }, {});
      })
  }

  _loadComments() {
    const currentStory = { ...this.currentStory };
    const query = currentStory;
    const options = {limit: 1e6};
    return this.db.getCollection('comments')
      .get(query, options)
      .then(comments => {
        // add to cache
        this.cache[this._getStoryKey(currentStory)] = comments;

        // set comments only if we are on the relavant story
        if (deepEquals(currentStory, this.currentStory)) {
          this._fireComments(comments);
        }
      });
  }

  _getStoryKey(currentStory) {
    return `${currentStory.sbKind}:::${currentStory.sbStory}`;
  }

  _fireComments(comments) {
    this.callbacks.forEach((callback) => {
      // link user to the comment directly
      comments.forEach((comment) => {
        comment.user = this.users[comment.userId];
      });

      callback(comments);
    });
  }

  onComments(cb) {
    this.callbacks.push(cb);
    const stop = () => {
      const index = this.callbacks.indexOf(cb);
      this.callbacks.splice(index, 1);
    };

    return stop;
  }

  _addPendingComment(comment) {
    // Add the pending comment.
    const pendingComment = { ...comment, loading: true };
    const storyKey = this._getStoryKey(this.currentStory);
    const existingComments = this.cache[storyKey];
    const updatedComments = existingComments.concat(pendingComment);

    this._fireComments(updatedComments);
    return Promise.resolve(null);
  }

  _setDeletedComment(comment) {
    const storyKey = this._getStoryKey(this.currentStory);
    const comments = this.cache[storyKey];
    const deleted = comments.find(c => c.id === comment.id);
    if (deleted) {
      deleted.loading = true;
    }
    this._fireComments(comments);
    return Promise.resolve(null);
  }

  _addAuthorToTheDatabase() {
    if (this.users[this.user.id]) {
      // user exists in the DB.
      return Promise.resolve(null);
    }

    return this.db.getCollection('users').set(this.user);
  }

  // NOTE the "sbProtected" makes sure only the author can modify
  // or delete a comment after its saved on the cloud database.
  _addCommentToDatabase(comment) {
    const doc = {
      ...comment,
      ...this.currentStory,
    };

    return this.db.getCollection('comments').set(doc);
  }

  _deleteCommentOnDatabase(comment) {
    const query = { id: comment.id };
    return this.db.getCollection('comments').del(query);
  }

  addComment(comment) {
    this._addPendingComment(comment)
      .then(() => this._addAuthorToTheDatabase())
      .then(() => this._addCommentToDatabase(comment))
      .then(() => this._loadUsers())
      .then(() => this._loadComments())
  }

  deleteComment(comment) {
    this._setDeletedComment(comment)
      .then(() => this._deleteCommentOnDatabase(comment))
      .then(() => this._loadComments())
  }
}
