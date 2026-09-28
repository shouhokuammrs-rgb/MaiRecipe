import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import "./index.css";
import { Find } from "./pages/Find";
import { Import } from "./pages/Import";
import { JoinGroup } from "./pages/JoinGroup";
import { Login } from "./pages/Login";
import { Plan } from "./pages/Plan";
import { RecipeDetail } from "./pages/RecipeDetail";
import { RecipeEdit } from "./pages/RecipeEdit";
import { RecipeNew } from "./pages/RecipeNew";
import { Recipes } from "./pages/Recipes";
import { Settings } from "./pages/Settings";
import { Shopping } from "./pages/Shopping";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Recipes /> },
      { path: "find", element: <Find /> },
      { path: "import", element: <Import /> },
      { path: "recipes/new", element: <RecipeNew /> },
      { path: "recipes/:id", element: <RecipeDetail /> },
      { path: "recipes/:id/edit", element: <RecipeEdit /> },
      { path: "plan", element: <Plan /> },
      { path: "shopping", element: <Shopping /> },
      { path: "settings", element: <Settings /> },
      { path: "invites/:id", element: <JoinGroup /> },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("#root が見つかりません");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
