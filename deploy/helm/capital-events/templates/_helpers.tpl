{{- define "ce.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "ce.labels" -}}
app.kubernetes.io/name: capital-events
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "ce.selector" -}}
app.kubernetes.io/name: capital-events
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "ce.image" -}}
{{- $img := index .root.Values.image .which -}}
{{- if not $img.tag }}{{ fail (printf "image.%s.tag is required (the git sha CI built)" .which) }}{{ end -}}
{{ $img.repository }}:{{ $img.tag }}
{{- end -}}
{{/* Pod security: non-root, read-only root filesystem, no privilege escalation, no capabilities. */}}
{{- define "ce.podSecurity" -}}
runAsNonRoot: true
runAsUser: 65532
runAsGroup: 65532
fsGroup: 65532
seccompProfile: { type: RuntimeDefault }
{{- end -}}
{{- define "ce.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: [ALL] }
{{- end -}}
{{- define "ce.apiEnv" -}}
{{- range $k, $v := .Values.api.env }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
- name: PORT
  value: "3000"
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.name }}, key: DATABASE_URL } }
- name: JWT_SECRET
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.name }}, key: JWT_SECRET, optional: true } }
- name: ANTHROPIC_API_KEY
  valueFrom: { secretKeyRef: { name: {{ .Values.secrets.name }}, key: ANTHROPIC_API_KEY, optional: true } }
{{- end -}}
