import { Linking, View } from 'react-native';
import type { Citation } from '@open42/shared-types';
import { ExternalLink } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { AppText } from '@/components/ui/Text';
import { formatRelativeDate } from '@/utils/dates';
import { colors } from '@/utils/theme';

interface CitationDetailSheetProps {
  citation: Citation | null;
  onClose: () => void;
}

export function CitationDetailSheet({ citation, onClose }: CitationDetailSheetProps) {
  return (
    <Sheet
      visible={!!citation}
      title={citation ? `Source [${citation.index}]` : 'Source'}
      onClose={onClose}>
      {citation ? (
        <View className="gap-4">
          <View>
            <AppText variant="body" weight="medium">
              {citation.slug}
            </AppText>
            <AppText variant="mono" tone="faint" style={{ marginTop: 4 }}>
              {citation.version_id ? `version ${citation.version_id}` : 'version unknown'} · updated{' '}
              {formatRelativeDate(citation.last_updated)}
            </AppText>
          </View>
          <AppText variant="muted" tone="body">
            {citation.excerpt || 'No excerpt was returned for this source.'}
          </AppText>
          {citation.slug.startsWith('http') ? (
            <Button
              variant="secondary"
              icon={<ExternalLink color={colors.textBody} size={15} strokeWidth={1.5} />}
              onPress={() => void Linking.openURL(citation.slug)}>
              Open source
            </Button>
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}
