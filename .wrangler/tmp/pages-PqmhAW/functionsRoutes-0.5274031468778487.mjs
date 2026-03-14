import { onRequestPost as __api_users_reset_password_js_onRequestPost } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\users\\reset-password.js"
import { onRequestDelete as __api_comments__id__js_onRequestDelete } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\comments\\[id].js"
import { onRequestOptions as __api_comments__id__js_onRequestOptions } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\comments\\[id].js"
import { onRequestGet as __api_profile__name__js_onRequestGet } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\profile\\[name].js"
import { onRequestGet as __api_comments_js_onRequestGet } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\comments.js"
import { onRequestOptions as __api_comments_js_onRequestOptions } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\comments.js"
import { onRequestPost as __api_comments_js_onRequestPost } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\comments.js"
import { onRequestDelete as __api_likes_js_onRequestDelete } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\likes.js"
import { onRequestGet as __api_likes_js_onRequestGet } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\likes.js"
import { onRequestOptions as __api_likes_js_onRequestOptions } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\likes.js"
import { onRequestPost as __api_likes_js_onRequestPost } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\likes.js"
import { onRequestPost as __api_users_js_onRequestPost } from "C:\\Users\\thoma\\Documents\\soundscape-atlas\\functions\\api\\users.js"

export const routes = [
    {
      routePath: "/api/users/reset-password",
      mountPath: "/api/users",
      method: "POST",
      middlewares: [],
      modules: [__api_users_reset_password_js_onRequestPost],
    },
  {
      routePath: "/api/comments/:id",
      mountPath: "/api/comments",
      method: "DELETE",
      middlewares: [],
      modules: [__api_comments__id__js_onRequestDelete],
    },
  {
      routePath: "/api/comments/:id",
      mountPath: "/api/comments",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_comments__id__js_onRequestOptions],
    },
  {
      routePath: "/api/profile/:name",
      mountPath: "/api/profile",
      method: "GET",
      middlewares: [],
      modules: [__api_profile__name__js_onRequestGet],
    },
  {
      routePath: "/api/comments",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_comments_js_onRequestGet],
    },
  {
      routePath: "/api/comments",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_comments_js_onRequestOptions],
    },
  {
      routePath: "/api/comments",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_comments_js_onRequestPost],
    },
  {
      routePath: "/api/likes",
      mountPath: "/api",
      method: "DELETE",
      middlewares: [],
      modules: [__api_likes_js_onRequestDelete],
    },
  {
      routePath: "/api/likes",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_likes_js_onRequestGet],
    },
  {
      routePath: "/api/likes",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_likes_js_onRequestOptions],
    },
  {
      routePath: "/api/likes",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_likes_js_onRequestPost],
    },
  {
      routePath: "/api/users",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_users_js_onRequestPost],
    },
  ]