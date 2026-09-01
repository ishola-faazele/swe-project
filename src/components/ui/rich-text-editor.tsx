import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Bold, Italic, List, ListOrdered, CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
}

const MenuBar = ({ editor }: { editor: Editor | null }) => {
  if (!editor) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-1 bg-muted/50 rounded-t-md">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={cn(
          "p-1.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground",
          editor.isActive('bold') && "bg-muted text-foreground"
        )}
        title="Bold"
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={cn(
          "p-1.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground",
          editor.isActive('italic') && "bg-muted text-foreground"
        )}
        title="Italic"
      >
        <Italic className="w-4 h-4" />
      </button>
      <div className="w-px h-4 bg-border mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn(
          "p-1.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground",
          editor.isActive('bulletList') && "bg-muted text-foreground"
        )}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn(
          "p-1.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground",
          editor.isActive('orderedList') && "bg-muted text-foreground"
        )}
        title="Numbered List"
      >
        <ListOrdered className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={cn(
          "p-1.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground",
          editor.isActive('taskList') && "bg-muted text-foreground"
        )}
        title="Checklist"
      >
        <CheckSquare className="w-4 h-4" />
      </button>
    </div>
  )
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = "min-h-[120px]" }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none p-3",
          minHeight
        ),
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  // To update content when `value` prop changes externally, e.g. when editing a different item
  // or clearing the form
  if (editor && value !== editor.getHTML() && !editor.isFocused) {
    editor.commands.setContent(value)
  }

  return (
    <div className="w-full rounded-md border border-input bg-transparent shadow-sm focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-shadow">
      <MenuBar editor={editor} />
      <EditorContent editor={editor} className="cursor-text" />
    </div>
  )
}
