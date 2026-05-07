import * as vscode from 'vscode';

function padDatePart(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatLogTimestamp(date = new Date()): string {
  return [
    date.getFullYear(),
    '-',
    padDatePart(date.getMonth() + 1),
    '-',
    padDatePart(date.getDate()),
    ' ',
    padDatePart(date.getHours()),
    ':',
    padDatePart(date.getMinutes()),
    ':',
    padDatePart(date.getSeconds()),
    '.',
    padDatePart(date.getMilliseconds(), 3)
  ].join('');
}

export function formatLogLine(message: string, date = new Date()): string {
  return `[${formatLogTimestamp(date)}] ${message}`;
}

export function createTimestampedOutputChannel(channel: vscode.OutputChannel): vscode.OutputChannel {
  const appendLine = channel.appendLine.bind(channel);
  channel.appendLine = (value: string): void => {
    const lines = value.split(/\r?\n/);
    for (const line of lines) {
      appendLine(formatLogLine(line));
    }
  };
  return channel;
}
