/**
 * Export service - handles exporting transcriptions to various formats
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

interface Segment {
  id: number
  transcriptionId: string
  speakerId: string | null
  startTime: number
  endTime: number
  text: string
  confidence: number | null
}

interface Speaker {
  id: string
  transcriptionId: string
  speakerId: string
  displayName: string | null
  color: string | null
}

interface Transcription {
  id: string
  fileName: string
  duration: number | null
  language: string | null
  completedAt: string | null
  createdAt: string
}

export type ExportFormat = 'srt' | 'vtt' | 'txt' | 'json' | 'docx'

export class ExporterService {
  private getSpeakerName(speakerId: string | null, speakers: Speaker[]): string {
    if (!speakerId) return 'Speaker'
    const speaker = speakers.find((s) => s.speakerId === speakerId)
    return speaker?.displayName || speakerId
  }

  private formatTime(seconds: number, format: 'srt' | 'vtt'): string {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)

    const timeSeparator = format === 'srt' ? ',' : '.'

    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${timeSeparator}${ms.toString().padStart(3, '0')}`
  }

  /**
   * Export to SRT (SubRip) subtitle format
   */
  toSRT(segments: Segment[], speakers: Speaker[]): string {
    const lines: string[] = []

    segments.forEach((seg, index) => {
      const speakerName = this.getSpeakerName(seg.speakerId, speakers)
      const startTime = this.formatTime(seg.startTime, 'srt')
      const endTime = this.formatTime(seg.endTime, 'srt')

      lines.push(`${index + 1}`)
      lines.push(`${startTime} --> ${endTime}`)
      lines.push(`[${speakerName}] ${seg.text}`)
      lines.push('')
    })

    return lines.join('\n')
  }

  /**
   * Export to WebVTT subtitle format
   */
  toVTT(segments: Segment[], speakers: Speaker[]): string {
    const lines: string[] = ['WEBVTT', '']

    segments.forEach((seg, index) => {
      const speakerName = this.getSpeakerName(seg.speakerId, speakers)
      const startTime = this.formatTime(seg.startTime, 'vtt')
      const endTime = this.formatTime(seg.endTime, 'vtt')

      lines.push(`${index + 1}`)
      lines.push(`${startTime} --> ${endTime}`)
      lines.push(`<v ${speakerName}>${seg.text}`)
      lines.push('')
    })

    return lines.join('\n')
  }

  /**
   * Export to plain text with speaker labels
   */
  toTXT(segments: Segment[], speakers: Speaker[]): string {
    const lines: string[] = []
    let lastSpeaker: string | null = null

    for (const seg of segments) {
      const speakerName = this.getSpeakerName(seg.speakerId, speakers)

      if (seg.speakerId !== lastSpeaker) {
        if (lines.length > 0) {
          lines.push('') // Add blank line between speakers
        }
        lines.push(`${speakerName}:`)
        lastSpeaker = seg.speakerId
      }

      lines.push(`  ${seg.text}`)
    }

    return lines.join('\n')
  }

  /**
   * Export to JSON with full structure
   */
  toJSON(transcription: Transcription, segments: Segment[], speakers: Speaker[]): string {
    const data = {
      metadata: {
        id: transcription.id,
        fileName: transcription.fileName,
        duration: transcription.duration,
        language: transcription.language,
        exportedAt: new Date().toISOString(),
        transcribedAt: transcription.completedAt || transcription.createdAt
      },
      speakers: speakers.map((s) => ({
        id: s.speakerId,
        name: s.displayName || s.speakerId,
        color: s.color
      })),
      segments: segments.map((seg) => ({
        start: seg.startTime,
        end: seg.endTime,
        text: seg.text,
        speaker: seg.speakerId,
        speakerName: this.getSpeakerName(seg.speakerId, speakers),
        confidence: seg.confidence
      }))
    }

    return JSON.stringify(data, null, 2)
  }

  /**
   * Export to DOCX (Word document)
   */
  async toDOCX(
    transcription: Transcription,
    segments: Segment[],
    speakers: Speaker[]
  ): Promise<Buffer> {
    const children: Paragraph[] = []

    // Title
    children.push(
      new Paragraph({
        text: transcription.fileName,
        heading: HeadingLevel.HEADING_1
      })
    )

    // Metadata
    const metaParts: string[] = []
    if (transcription.duration) {
      const mins = Math.floor(transcription.duration / 60)
      const secs = Math.floor(transcription.duration % 60)
      metaParts.push(`Duration: ${mins}:${secs.toString().padStart(2, '0')}`)
    }
    if (transcription.language) {
      metaParts.push(`Language: ${transcription.language}`)
    }
    if (transcription.completedAt) {
      metaParts.push(`Transcribed: ${new Date(transcription.completedAt).toLocaleDateString()}`)
    }

    if (metaParts.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: metaParts.join(' | '),
              italics: true,
              color: '666666'
            })
          ]
        })
      )
      children.push(new Paragraph({})) // Blank line
    }

    // Group segments by speaker
    let lastSpeaker: string | null = null

    for (const seg of segments) {
      const speakerName = this.getSpeakerName(seg.speakerId, speakers)

      if (seg.speakerId !== lastSpeaker) {
        children.push(new Paragraph({})) // Blank line before new speaker
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: speakerName,
                bold: true
              })
            ]
          })
        )
        lastSpeaker = seg.speakerId
      }

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: seg.text
            })
          ]
        })
      )
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children
        }
      ]
    })

    return await Packer.toBuffer(doc)
  }

  /**
   * Export to the specified format
   */
  async export(
    format: ExportFormat,
    transcription: Transcription,
    segments: Segment[],
    speakers: Speaker[]
  ): Promise<{ content: string | Buffer; mimeType: string; extension: string }> {
    switch (format) {
      case 'srt':
        return {
          content: this.toSRT(segments, speakers),
          mimeType: 'text/plain',
          extension: 'srt'
        }
      case 'vtt':
        return {
          content: this.toVTT(segments, speakers),
          mimeType: 'text/vtt',
          extension: 'vtt'
        }
      case 'txt':
        return {
          content: this.toTXT(segments, speakers),
          mimeType: 'text/plain',
          extension: 'txt'
        }
      case 'json':
        return {
          content: this.toJSON(transcription, segments, speakers),
          mimeType: 'application/json',
          extension: 'json'
        }
      case 'docx':
        return {
          content: await this.toDOCX(transcription, segments, speakers),
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          extension: 'docx'
        }
      default:
        throw new Error(`Unknown export format: ${format}`)
    }
  }
}

// Singleton instance
let exporterInstance: ExporterService | null = null

export function getExporterService(): ExporterService {
  if (!exporterInstance) {
    exporterInstance = new ExporterService()
  }
  return exporterInstance
}
