import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { NodeKind } from "@/domain/doc";
import { styles } from "../styles";
import { NodeViewModel } from "../types";
import { fmtDate } from "../utils";

// route query panel: two search inputs with autocomplete suggestions.
// Each field can also be filled by tapping a node on the canvas.
export function RoutePanel(props: {
  query: { from: string; to: string };
  pickerField: "from" | "to" | null;
  // the suggestion pool: the currently visible nodes
  nodes: NodeViewModel[];
  hasRoutes: boolean;
  onFocusField: (field: "from" | "to") => void;
  onChangeQuery: (field: "from" | "to", text: string) => void;
  onPickSuggestion: (field: "from" | "to", id: string, title: string) => void;
  onSwap: () => void;
  onShowRoutes: () => void;
  onClose: () => void;
}) {
  // autocomplete suggestions for the focused route search field
  const suggestionsFor = (field: "from" | "to"): NodeViewModel[] =>
    props.pickerField === field
      ? props.nodes
          .filter((n) =>
            n.title.toLowerCase().includes(props.query[field].trim().toLowerCase()),
          )
          .slice(0, 5)
      : [];

  const renderField = (field: "from" | "to") => (
    <View key={field}>
      <View
        style={[
          styles.routeRow,
          props.pickerField === field && styles.routeRowActive,
        ]}
      >
        <Text style={styles.routeRowLabel}>
          {field === "from" ? "From" : "To"}
        </Text>
        <TextInput
          style={styles.routeInput}
          placeholder="Type a node name, or tap it on the map"
          value={props.query[field]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onFocus={() => props.onFocusField(field)}
          onChangeText={(t) => props.onChangeQuery(field, t)}
        />
      </View>
      {props.pickerField === field &&
        suggestionsFor(field).map((n) => (
          <Pressable
            key={n.id}
            style={styles.routeSuggestion}
            onPress={() => props.onPickSuggestion(field, n.id, n.title)}
          >
            <Text style={styles.routeSuggestionText}>
              {n.title}
              <Text style={styles.routeSuggestionKind}>
                {"  "}
                {n.kind}
              </Text>
            </Text>
          </Pressable>
        ))}
    </View>
  );
  return (
    <View style={styles.routePanel}>
      <View style={styles.routeFields}>
        {renderField("from")}
        {renderField("to")}
      </View>
      <Pressable style={styles.routeIconButton} onPress={props.onSwap}>
        <Text style={styles.routeIconButtonText}>⇅</Text>
      </Pressable>
      {props.hasRoutes && (
        <Pressable style={styles.routeIconButton} onPress={props.onShowRoutes}>
          <Text style={styles.routeIconButtonText}>☰</Text>
        </Pressable>
      )}
      <Pressable style={styles.routeIconButton} onPress={props.onClose}>
        <Text style={styles.routeIconButtonText}>✕</Text>
      </Pressable>
    </View>
  );
}

// note query panel: one search input over every note on the map; each
// result shows the note excerpt and its owning node
export function NoteSearchPanel(props: {
  query: string;
  results: { noteId: string; nodeId: string; excerpt: string; nodeTitle: string; nodeKind: NodeKind; createdAt: number }[];
  onChangeQuery: (text: string) => void;
  onPickResult: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.routePanel}>
      <View style={styles.routeFields}>
        <View style={styles.routeRow}>
          <Text style={styles.routeRowLabel}>Note</Text>
          <TextInput
            style={styles.routeInput}
            placeholder="Search notes…"
            value={props.query}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            autoFocus
            onChangeText={props.onChangeQuery}
          />
        </View>
        {props.query.trim() !== "" && props.results.length === 0 && (
          <Text style={styles.noteSearchEmpty}>No notes match</Text>
        )}
        <ScrollView style={styles.noteResults}>
          {props.results.map((r) => (
            <Pressable
              key={r.noteId}
              style={styles.routeSuggestion}
              onPress={() => props.onPickResult(r.nodeId)}
            >
              <Text style={styles.routeSuggestionText} numberOfLines={1}>
                {r.excerpt}
              </Text>
              <Text style={styles.routeSuggestionKind}>
                {r.nodeTitle}
                {"  "}
                {r.nodeKind} · {fmtDate(r.createdAt)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Pressable style={styles.routeIconButton} onPress={props.onClose}>
        <Text style={styles.routeIconButtonText}>✕</Text>
      </Pressable>
    </View>
  );
}
