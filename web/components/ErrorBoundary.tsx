'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-gray-950 p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono break-all">
              {this.state.error.message}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 text-sm rounded-lg bg-teal-500 text-white hover:bg-teal-600 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
