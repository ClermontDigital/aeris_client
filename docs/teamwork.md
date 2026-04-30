# Teamwork Spaces API Guide

## Overview
This guide provides comprehensive instructions for creating and updating pages in Teamwork Spaces via API. It includes authentication setup, API endpoints, critical gotchas, and common workflows.

## Authentication Setup

Set up your environment variables:

```bash
export TOKEN="your_teamwork_api_token_here"
export SPACE_ID="your_space_id_here"
export INSTALLATION="your_installation_name"
```

**Example:**
```bash
export TOKEN="tkn.v1_abc123..."
export SPACE_ID="4632"
export INSTALLATION="clermontdigital"
```

## API Endpoints

### Base URL Structure
```
https://{INSTALLATION}.teamwork.com/spaces/api/v1/spaces/{SPACE_ID}/pages
```

### Get Page Details
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json"
```

### List All Pages in Space
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages.json"
```

### Create New Page
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages.json" \
  -d @page.json
```

**JSON Payload for Creation (page.json):**
```json
{
  "page": {
    "title": "Page Title",
    "content": "<h2>Overview</h2>\n<div>Content here</div>",
    "parentId": "42167",
    "draftVersion": 1
  }
}
```

### Update Existing Page
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X PATCH "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json" \
  -d @page_update.json
```

**JSON Payload for Update (page_update.json):**
```json
{
  "page": {
    "title": "Updated Title",
    "content": "<h2>New content</h2>",
    "draftVersion": 2
  }
}
```

### Publish Draft Page
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}/publish.json"
```

## Critical Gotchas

### 1. Use PATCH for Updates, NOT PUT
- **Issue:** PUT requests return 404 errors
- **Solution:** Always use PATCH for updating existing pages
- **Example:** `curl -X PATCH ...` not `curl -X PUT ...`

### 2. parentId Handling
- **For Creation:** parentId can be included as a string
  ```json
  {
    "page": {
      "parentId": "42167"
    }
  }
  ```
- **For Updates:** NEVER include parentId in update payloads
  - Including it causes: `json: cannot unmarshal string into Go struct field PageUpdate.parentId of type int64`
  - Parent cannot be changed via update - only via move operation

### 3. draftVersion is Required
- **For Creation:** Set `draftVersion: 1`
- **For Updates:**
  1. Get current page to find current draftVersion
  2. Increment by 1
  3. Include in update payload
- **Missing draftVersion:** Causes validation errors

### 4. Content Formatting Rules

**HTML Structure:**
- Start with `<h2>` not `<h1>` (Teamwork displays page title as H1)
- Use `<div>` for paragraphs
- Use `<ul>/<ol>` for lists
- Use `<table>` with `<thead>` and `<tbody>` for tables
- Use `<strong>` for bold, `<em>` for emphasis
- Escape newlines as `\n` in JSON

**Example:**
```json
{
  "page": {
    "content": "<h2>Overview</h2>\n<div>This is a paragraph.</div>\n<ul>\n  <li>List item 1</li>\n  <li>List item 2</li>\n</ul>"
  }
}
```

### 5. Draft vs Published Pages
- Pages are created as drafts by default
- Use publish endpoint to make pages visible: `/pages/{PAGE_ID}/publish.json`
- Cannot be done via main update endpoint

## Common Workflow

### Creating a New Page

1. **Prepare JSON file:**
   ```bash
   cat > /tmp/new_page.json <<'EOF'
   {
     "page": {
       "title": "My New Page",
       "content": "<h2>Overview</h2>\n<div>Page content goes here.</div>",
       "parentId": "12345",
       "draftVersion": 1
     }
   }
   EOF
   ```

2. **Create the page:**
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages.json" \
     -d @/tmp/new_page.json | python3 -m json.tool
   ```

3. **Extract PAGE_ID from response:**
   ```bash
   PAGE_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages.json" \
     -d @/tmp/new_page.json | python3 -c "import sys, json; print(json.load(sys.stdin)['page']['id'])")
   ```

4. **Publish the page:**
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/${PAGE_ID}/publish.json"
   ```

### Updating an Existing Page

1. **Get current page details:**
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json" \
     > /tmp/current_page.json
   ```

2. **Extract current draftVersion:**
   ```bash
   CURRENT_VERSION=$(cat /tmp/current_page.json | python3 -c "import sys, json; print(json.load(sys.stdin)['page']['draftVersion'])")
   NEW_VERSION=$((CURRENT_VERSION + 1))
   ```

3. **Prepare update JSON:**
   ```bash
   cat > /tmp/update_page.json <<EOF
   {
     "page": {
       "title": "Updated Title",
       "content": "<h2>Updated Content</h2>\n<div>New content here.</div>",
       "draftVersion": ${NEW_VERSION}
     }
   }
   EOF
   ```

4. **Apply the update:**
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X PATCH "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json" \
     -d @/tmp/update_page.json
   ```

5. **Publish if needed:**
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}/publish.json"
   ```

## Error Handling

### Common Errors and Solutions

| Error Code | Error Message | Solution |
|------------|---------------|----------|
| 404 | Not Found | Check PAGE_ID is correct; ensure using PATCH not PUT |
| 107 | addon plan page limit reached | Upgrade plan or delete unused pages |
| 400 | cannot unmarshal string into type int64 | Remove `parentId` from update payload |
| 400 | Validation error | Check `draftVersion` is included and incremented |
| 401 | Unauthorized | Verify TOKEN is correct and not expired |

### Checking Response Status

Always check the HTTP response or parse JSON for errors:

```bash
response=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X PATCH "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json" \
  -d @/tmp/update.json)

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
  echo "Success: $body"
else
  echo "Error $http_code: $body"
fi
```

## Page Hierarchy Management

### Understanding Parent-Child Relationships

- **Root Pages:** No `parentId` or `parentId: null`
- **Child Pages:** Include `parentId` pointing to parent page ID
- **Hierarchy Depth:** Can nest multiple levels
- **Moving Pages:** Parent cannot be changed via update - requires separate move operation

### Example Hierarchy

```
Homepage (ID: 12345)
├── Section 1 (ID: 12346, parentId: "12345")
│   ├── Subsection 1.1 (ID: 12347, parentId: "12346")
│   └── Subsection 1.2 (ID: 12348, parentId: "12346")
└── Section 2 (ID: 12349, parentId: "12345")
    └── Subsection 2.1 (ID: 12350, parentId: "12349")
```

## Content Formatting Best Practices

### HTML Structure
- Always start with `<h2>` for first heading
- Use semantic HTML elements
- Keep consistent nesting and indentation
- Escape special characters in JSON strings

### Tables
```html
<table>
  <thead>
    <tr>
      <th>Column 1</th>
      <th>Column 2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Data 1</td>
      <td>Data 2</td>
    </tr>
  </tbody>
</table>
```

### Lists
```html
<ul>
  <li><strong>Bold Item:</strong> Description here</li>
  <li><strong>Another Item:</strong> More details</li>
</ul>

<ol>
  <li><strong>Step 1:</strong> Do this first</li>
  <li><strong>Step 2:</strong> Then do this</li>
</ol>
```

### Links
```html
<a href="https://example.com">Link Text</a>
<a href="#">Internal link placeholder</a>
```

## Python Helper Script

For easier JSON manipulation:

```python
#!/usr/bin/env python3
import json
import sys
import os

def create_page_json(title, content, parent_id=None, draft_version=1):
    """Create JSON payload for new page"""
    page = {
        "page": {
            "title": title,
            "content": content,
            "draftVersion": draft_version
        }
    }
    if parent_id:
        page["page"]["parentId"] = str(parent_id)
    return json.dumps(page, indent=2)

def update_page_json(title, content, draft_version):
    """Create JSON payload for page update (no parentId)"""
    page = {
        "page": {
            "title": title,
            "content": content,
            "draftVersion": draft_version
        }
    }
    return json.dumps(page, indent=2)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: script.py [create|update] title content [parent_id] [draft_version]")
        sys.exit(1)

    action = sys.argv[1]
    title = sys.argv[2]
    content = sys.argv[3]

    if action == "create":
        parent_id = sys.argv[4] if len(sys.argv) > 4 else None
        draft_version = int(sys.argv[5]) if len(sys.argv) > 5 else 1
        print(create_page_json(title, content, parent_id, draft_version))
    elif action == "update":
        draft_version = int(sys.argv[4]) if len(sys.argv) > 4 else 2
        print(update_page_json(title, content, draft_version))
```

## Tips and Tricks

1. **Save page IDs:** Keep a mapping file of page titles to IDs for easy reference
2. **Version tracking:** Keep track of draftVersion numbers to avoid conflicts
3. **Test on draft:** Always test changes on draft pages before publishing
4. **Backup content:** Save JSON payloads before updates for easy rollback
5. **Use pretty-print:** Pipe responses through `python3 -m json.tool` for readability
6. **Batch operations:** When creating multiple pages, collect IDs for later reference

## Complete Example Workflow

```bash
#!/bin/bash

# Configuration
export TOKEN="your_token_here"
export SPACE_ID="your_space_id"
export INSTALLATION="your_installation"

# Create a new section
cat > /tmp/section.json <<'EOF'
{
  "page": {
    "title": "New Section",
    "content": "<h2>Overview</h2>\n<div>This is a new section.</div>",
    "draftVersion": 1
  }
}
EOF

# Create the page and capture ID
SECTION_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages.json" \
  -d @/tmp/section.json | python3 -c "import sys, json; print(json.load(sys.stdin)['page']['id'])")

echo "Created section with ID: $SECTION_ID"

# Create a child page under the section
cat > /tmp/child.json <<EOF
{
  "page": {
    "title": "Child Page",
    "content": "<h2>Overview</h2>\n<div>This is a child page.</div>",
    "parentId": "${SECTION_ID}",
    "draftVersion": 1
  }
}
EOF

CHILD_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages.json" \
  -d @/tmp/child.json | python3 -c "import sys, json; print(json.load(sys.stdin)['page']['id'])")

echo "Created child page with ID: $CHILD_ID"

# Publish both pages
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/${SECTION_ID}/publish.json"

curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/${CHILD_ID}/publish.json"

echo "Pages published successfully"
```

## Summary

**Key Points to Remember:**
- Use PATCH for updates, not PUT
- Never include parentId in update payloads
- Always increment draftVersion for updates
- Start content with `<h2>`, never `<h1>`
- Pages are created as drafts, publish separately
- Keep track of page IDs for hierarchy management

**Common Pattern:**
1. Create JSON payload → 2. POST/PATCH to API → 3. Extract response → 4. Publish if needed

This guide should enable any agent to successfully manage Teamwork Spaces pages via API.
